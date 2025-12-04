export interface FitsHeaderCard {
  key: string;
  value: string | number | boolean | null;
  comment?: string;
}

export interface FitsColumnDef {
  label: string;
  format: string; // TFORMn
  unit?: string; // TUNITn
  type?: string; // TTYPEn
  offset: number; // calculated offset in row
  dataType: 'FLOAT' | 'DOUBLE' | 'INT' | 'SHORT' | 'BYTE' | 'UNKNOWN';
}

export interface ParsedFitsData {
  primaryHeader: FitsHeaderCard[];
  extensionHeader: FitsHeaderCard[];
  data: Record<string, (number | null)[]>; // Column name -> Array of values
  columns: string[];
  rowCount: number;
}

export interface DataPoint {
  time: number;
  flux: number;
  error?: number;
}