export interface TextOccurrence {
  startIndex: number;
  endIndex: number;
  startLine: number;
  preview: string;
  method: string; 
}
export interface FileLogOccurrences {
  filePath: string;
  occurrences: TextOccurrence[];
}