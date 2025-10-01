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

export interface BackupData {
  timestamp: string;
  files: Array<{
    filePath: string;
    originalContent: string;
  }>;
}