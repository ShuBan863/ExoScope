export interface FitsHeaderCard {
  key: string;
  value: string | number | boolean | null;
  comment?: string;
}

export interface FitsColumnDef {
  label: string;
  format: string;
  unit?: string;
  type?: string; 
  offset: number; 
  dataType: 'FLOAT' | 'DOUBLE' | 'INT' | 'SHORT' | 'BYTE' | 'UNKNOWN';
}

export interface ParsedFitsData {
  primaryHeader: FitsHeaderCard[];
  extensionHeader: FitsHeaderCard[];
  data: Record<string, (number | null)[]>;
  columns: string[];
  rowCount: number;
}

export interface DataPoint {
  time: number;
  flux: number;
  error?: number;
}
