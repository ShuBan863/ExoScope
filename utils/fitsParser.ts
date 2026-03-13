import { FitsHeaderCard, FitsColumnDef, ParsedFitsData } from '../types';

export const parseFitsFile = async (buffer: ArrayBuffer): Promise<ParsedFitsData> => {
  const dataView = new DataView(buffer);
  let offset = 0;

  
  const { header: primaryHeader, bytesRead: primaryBytes } = parseHeaderUnit(dataView, offset);
  offset += primaryBytes;

  
  const primaryNaxis = Number(getHeaderValue(primaryHeader, 'NAXIS') || 0);
  if (primaryNaxis > 0) {
    let numPixels = 1;
    for (let i = 1; i <= primaryNaxis; i++) {
      numPixels *= Number(getHeaderValue(primaryHeader, `NAXIS${i}`) || 0);
    }
    const bitpix = Number(getHeaderValue(primaryHeader, 'BITPIX') || 0);
    const dataSize = Math.abs(bitpix) * numPixels / 8;
    const padding = (2880 - (dataSize % 2880)) % 2880;
    offset += dataSize + padding;
  }

  
  let extensionHeader: FitsHeaderCard[] = [];
  let tableData: ParsedFitsData['data'] = {};
  let columns: string[] = [];
  let rowCount = 0;

  let loopLimit = 10;

  while (offset < buffer.byteLength && loopLimit > 0) {
    const { header, bytesRead } = parseHeaderUnit(dataView, offset);
    const xtension = header.find(c => c.key === 'XTENSION');

    if (xtension && xtension.value === 'BINTABLE') {
      extensionHeader = header;
      offset += bytesRead;

      const nAxis1 = Number(getHeaderValue(header, 'NAXIS1') || 0); 
      const nAxis2 = Number(getHeaderValue(header, 'NAXIS2') || 0); 
      const tFields = Number(getHeaderValue(header, 'TFIELDS') || 0);

      rowCount = nAxis2;

      
      const colDefs = parseColumnDefinitions(header, tFields, nAxis1);
      columns = colDefs.filter(c => c.dataType !== 'UNKNOWN').map(c => c.type || c.label);

      
      tableData = readBinaryTable(dataView, offset, nAxis2, nAxis1, colDefs);
      break;

    } else {
      
      offset += bytesRead;
      const naxis = Number(getHeaderValue(header, 'NAXIS') || 0);
      let dataSize = 0;
      if (naxis > 0) {
        let numPixels = 1;
        for (let i = 1; i <= naxis; i++) {
          numPixels *= Number(getHeaderValue(header, `NAXIS${i}`) || 0);
        }
        const bitpix = Number(getHeaderValue(header, 'BITPIX') || 0);
        const pCount = Number(getHeaderValue(header, 'PCOUNT') || 0);
        const gCount = Number(getHeaderValue(header, 'GCOUNT') || 1);
        
        dataSize = gCount * (Math.abs(bitpix) * numPixels / 8 + pCount);
      }
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
    let line = '';
    for (let i = 0; i < cardSize; i++) {
      line += String.fromCharCode(view.getUint8(offset + i));
    }

    const key = line.substring(0, 8).trim();

    if (key === 'END') {
      offset += cardSize;
      break;
    }

    let value: string | number | boolean | null = null;
    let comment = '';

    if (key.length > 0) {
      const valueIndicatorIdx = line.indexOf('=');
      if (valueIndicatorIdx > -1 && valueIndicatorIdx < 10) {
        const afterEquals = line.substring(valueIndicatorIdx + 1).trimStart();

        if (afterEquals.startsWith("'")) {
          
          
          
          
          
          let strStart = line.indexOf("'", valueIndicatorIdx + 1);
          let strEnd = strStart + 1;
          while (strEnd < line.length) {
            if (line[strEnd] === "'") {
              
              if (strEnd + 1 < line.length && line[strEnd + 1] === "'") {
                strEnd += 2; 
              } else {
                break; 
              }
            } else {
              strEnd++;
            }
          }
          
          const rawStr = line.substring(strStart + 1, strEnd).replace(/''/g, "'").trimEnd();
          value = rawStr;

          
          const commentIdx = line.indexOf('/', strEnd + 1);
          if (commentIdx > -1) {
            comment = line.substring(commentIdx + 1).trim();
          }

        } else {
          
          const commentIdx = line.indexOf('/', valueIndicatorIdx + 1);
          let valueStr = '';
          if (commentIdx > -1) {
            valueStr = line.substring(valueIndicatorIdx + 1, commentIdx).trim();
            comment = line.substring(commentIdx + 1).trim();
          } else {
            valueStr = line.substring(valueIndicatorIdx + 1).trim();
          }

          if (valueStr === 'T') {
            value = true;
          } else if (valueStr === 'F') {
            value = false;
          } else {
            const num = Number(valueStr);
            value = isNaN(num) ? valueStr : num;
          }
        }
      }

      cards.push({ key, value, comment });
    }

    offset += cardSize;
  }

  const totalBytesRead = offset - startOffset;
  const padding = (2880 - (totalBytesRead % 2880)) % 2880;
  return { header: cards, bytesRead: totalBytesRead + padding };
};

const tformByteSize = (typeChar: string, repeat: number): number => {
  switch (typeChar) {
    case 'D': return repeat * 8;  
    case 'E': return repeat * 4;  
    case 'J': return repeat * 4;  
    case 'K': return repeat * 8;  
    case 'I': return repeat * 2;  
    case 'B': return repeat * 1;  
    case 'L': return repeat * 1;  
    case 'A': return repeat * 1;  
    case 'X': return Math.ceil(repeat / 8); 
    case 'C': return repeat * 8;  
    case 'M': return repeat * 16; 
    case 'P': return 8;           
    case 'Q': return 16;          
    default:  return 0;           
  }
};

const parseColumnDefinitions = (
  header: FitsHeaderCard[],
  tFields: number,
  nAxis1: number   
): FitsColumnDef[] => {
  const cols: FitsColumnDef[] = [];
  let currentOffset = 0;

  for (let i = 1; i <= tFields; i++) {
    const type = getHeaderValue(header, `TTYPE${i}`) as string || `COL${i}`;
    const form = getHeaderValue(header, `TFORM${i}`) as string || '';
    const unit = getHeaderValue(header, `TUNIT${i}`) as string || '';

    
    const tformMatch = form.trim().match(/^(\d*)([A-Z])/);
    const repeat = tformMatch && tformMatch[1] ? parseInt(tformMatch[1], 10) : 1;
    const typeChar = tformMatch ? tformMatch[2] : '';

    
    const totalBytes = tformByteSize(typeChar, repeat);

    
    let dataType: FitsColumnDef['dataType'] = 'UNKNOWN';
    if (repeat === 1) {
      switch (typeChar) {
        case 'D': dataType = 'DOUBLE'; break;
        case 'E': dataType = 'FLOAT';  break;
        case 'J': dataType = 'INT';    break;
        case 'I': dataType = 'SHORT';  break;
        case 'B': dataType = 'BYTE';   break;
        
      }
    }
    
    

    cols.push({
      label: type,
      format: form,
      unit,
      type,
      offset: currentOffset,
      dataType,
    });

    
    if (totalBytes > 0) {
      currentOffset += totalBytes;
    } else {
      
      
      console.warn(`[fitsParser] Unrecognised TFORM '${form}' for column ${type}. Halting column parse.`);
      break;
    }
  }

  
  if (nAxis1 > 0 && currentOffset !== nAxis1) {
    console.warn(
      `[fitsParser] Computed row size (${currentOffset} B) ≠ NAXIS1 (${nAxis1} B). ` +
      `File may contain unsupported TFORM types. Some columns may be misaligned.`
    );
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
  
  cols
    .filter(c => c.dataType !== 'UNKNOWN')
    .forEach(c => result[c.type || c.label] = []);

  for (let r = 0; r < rowCount; r++) {
    const rowStart = startOffset + r * rowBytes;

    cols.forEach(col => {
      if (col.dataType === 'UNKNOWN') return; 

      const pos = rowStart + col.offset;
      let val: number | null = null;

      try {
        switch (col.dataType) {
          case 'DOUBLE': val = view.getFloat64(pos, false); break;
          case 'FLOAT':  val = view.getFloat32(pos, false); break;
          case 'INT':    val = view.getInt32(pos,   false); break;
          case 'SHORT':  val = view.getInt16(pos,   false); break;
          case 'BYTE':   val = view.getUint8(pos);          break;
        }
        if (typeof val === 'number' && isNaN(val)) val = null;
      } catch {
        console.warn(`[fitsParser] Read error at row ${r}, col ${col.label}`);
        val = null;
      }

      result[col.type || col.label].push(val);
    });
  }

  return result;
};
