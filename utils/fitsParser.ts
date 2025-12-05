import { FitsHeaderCard, FitsColumnDef, ParsedFitsData } from '../types';


 // Parses a standard FITS file (Kepler/TESS format).
 // This is a custom binary parser that handles standard FITS headers and Binary Tables.
 
export const parseFitsFile = async (buffer: ArrayBuffer): Promise<ParsedFitsData> => {
  const dataView = new DataView(buffer);
  let offset = 0;

  // Parse Primary Header
  const { header: primaryHeader, bytesRead: primaryBytes } = parseHeaderUnit(dataView, offset);
  offset += primaryBytes;

  // Scan for Extensions
  let extensionHeader: FitsHeaderCard[] = [];
  let tableData: ParsedFitsData['data'] = {};
  let columns: string[] = [];
  let rowCount = 0;

  // Safety limit 
  let loopLimit = 10;
  
  while (offset < buffer.byteLength && loopLimit > 0) {
    // Check for header
    const { header, bytesRead } = parseHeaderUnit(dataView, offset);
    
    // Check for XTENSION
    const xtension = header.find(c => c.key === 'XTENSION');
    
    if (xtension && xtension.value === 'BINTABLE') {
      // binary table
      extensionHeader = header;
      offset += bytesRead;
      
      const pCount = Number(getHeaderValue(header, 'PCOUNT') || 0);
      const gCount = Number(getHeaderValue(header, 'GCOUNT') || 1);
      const nAxis1 = Number(getHeaderValue(header, 'NAXIS1') || 0); // Bytes per row
      const nAxis2 = Number(getHeaderValue(header, 'NAXIS2') || 0); // Number of rows
      const tFields = Number(getHeaderValue(header, 'TFIELDS') || 0);
      
      rowCount = nAxis2;
      
      // Parse Column Definitions
      const colDefs = parseColumnDefinitions(header, tFields);
      columns = colDefs.map(c => c.type || c.label);
      
      // Read the Binary Data
      tableData = readBinaryTable(dataView, offset, nAxis2, nAxis1, colDefs);
      
      // break loop
      break;
    } else {
      
      offset += bytesRead;
      // Calculate data size to skip
      const naxis = Number(getHeaderValue(header, 'NAXIS') || 0);
      let dataSize = 0;
      if (naxis > 0) {
        let numPixels = 1;
        for (let i = 1; i <= naxis; i++) {
            numPixels *= Number(getHeaderValue(header, `NAXIS${i}`) || 0);
        }
        const bitpix = Number(getHeaderValue(header, 'BITPIX'));
        dataSize = Math.abs(bitpix) * numPixels / 8;
      }
      
      const pCount = Number(getHeaderValue(header, 'PCOUNT') || 0);
      const gCount = Number(getHeaderValue(header, 'GCOUNT') || 1);
      dataSize += pCount * gCount; // Approximation for specialized FITS
      
      // FITS blocks are 2880 bytes
      const padding = (2880 - (dataSize % 2880)) % 2880;
      offset += dataSize + padding;
    }
    loopLimit--;
  }

  if (Object.keys(tableData).length === 0) {
    throw new Error("No BINTABLE extension found in FITS file.");
  }

  return {
    primaryHeader,
    extensionHeader,
    data: tableData,
    columns,
    rowCount
  };
};

const getHeaderValue = (cards: FitsHeaderCard[], key: string): string | number | boolean | null => {
  const card = cards.find(c => c.key === key);
  return card ? card.value : null;
};

const parseHeaderUnit = (view: DataView, startOffset: number) => {
  const cards: FitsHeaderCard[] = [];
  let offset = startOffset;
  const cardSize = 80;
  
  while (offset < view.byteLength) {
    // Read 80 bytes as ASCII
    let line = '';
    for (let i = 0; i < cardSize; i++) {
      line += String.fromCharCode(view.getUint8(offset + i));
    }

    const key = line.substring(0, 8).trim();
    
    if (key === 'END') {
      offset += cardSize;
      break;
    }

    // Parse Value
    
    let value: string | number | boolean | null = null;
    let comment = '';

    if (key.length > 0) {
        const valueIndicatorIdx = line.indexOf('=');
        if (valueIndicatorIdx > -1 && valueIndicatorIdx < 10) {
             const commentIdx = line.indexOf('/', valueIndicatorIdx);
             let valueStr = '';
             if (commentIdx > -1) {
                 valueStr = line.substring(valueIndicatorIdx + 1, commentIdx).trim();
                 comment = line.substring(commentIdx + 1).trim();
             } else {
                 valueStr = line.substring(valueIndicatorIdx + 1).trim();
             }

             // Remove quotes for strings
             if (valueStr.startsWith("'") && valueStr.endsWith("'")) {
                value = valueStr.substring(1, valueStr.length - 1).trim();
             } else if (valueStr === 'T') {
                value = true;
             } else if (valueStr === 'F') {
                value = false;
             } else {
                const num = Number(valueStr);
                value = isNaN(num) ? valueStr : num;
             }
        }
        
        cards.push({ key, value, comment });
    }
    
    offset += cardSize;
  }

  // Calculate padding 
  const totalBytesRead = offset - startOffset;
  const padding = (2880 - (totalBytesRead % 2880)) % 2880;
  
  return { header: cards, bytesRead: totalBytesRead + padding };
};

const parseColumnDefinitions = (header: FitsHeaderCard[], tFields: number): FitsColumnDef[] => {
  const cols: FitsColumnDef[] = [];
  let currentOffset = 0;

  for (let i = 1; i <= tFields; i++) {
    const type = getHeaderValue(header, `TTYPE${i}`) as string || `COL${i}`;
    const form = getHeaderValue(header, `TFORM${i}`) as string || '';
    const unit = getHeaderValue(header, `TUNIT${i}`) as string || '';
    
    // Determine byte size and type from TFORM 
   
    const typeChar = form.replace(/[0-9]/g, '').trim();
    let byteSize = 0;
    let dataType: FitsColumnDef['dataType'] = 'UNKNOWN';

    switch (typeChar) {
      case 'D': byteSize = 8; dataType = 'DOUBLE'; break;
      case 'E': byteSize = 4; dataType = 'FLOAT'; break;
      case 'J': byteSize = 4; dataType = 'INT'; break;
      case 'I': byteSize = 2; dataType = 'SHORT'; break;
      case 'B': byteSize = 1; dataType = 'BYTE'; break;
      default: byteSize = 0; // Skip unknown or complex types 
    }
    
    if (byteSize > 0) {
        cols.push({
            label: type,
            format: form,
            unit,
            type: type,
            offset: currentOffset,
            dataType
        });
        currentOffset += byteSize;
    } else {

    }
  }
  return cols;
};

const readBinaryTable = (
    view: DataView, 
    startOffset: number, 
    rowCount: number, 
    rowBytes: number, 
    cols: FitsColumnDef[]
): Record<string, (number | null)[]> => {
    
    const result: Record<string, (number | null)[]> = {};
    cols.forEach(c => result[c.type || c.label] = []);

    for (let r = 0; r < rowCount; r++) {
        const rowStart = startOffset + (r * rowBytes);
        
        cols.forEach(col => {
            const pos = rowStart + col.offset;
            let val: number | null = null;
            
            // FITS is Big Endian
            try {
                switch (col.dataType) {
                    case 'DOUBLE': val = view.getFloat64(pos, false); break;
                    case 'FLOAT': val = view.getFloat32(pos, false); break;
                    case 'INT': val = view.getInt32(pos, false); break;
                    case 'SHORT': val = view.getInt16(pos, false); break;
                    case 'BYTE': val = view.getUint8(pos); break;
                }
                
                // Handle NaNs 
                if (typeof val === 'number' && isNaN(val)) {
                    val = null;
                }
            } catch (e) {
                console.warn("Error reading row", r, col.label);
                val = null;
            }

            result[col.type || col.label].push(val);
        });
    }

    return result;
};
