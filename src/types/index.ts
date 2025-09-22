import { Uri } from 'vscode';

export type MatchType = 'ConsoleCall' | 'SingleLineComment' | 'BlockComment' | 'JSXComment';

export interface MatchItem {
  uri: Uri;
  relativePath: string;
  line: number;
  endLine?: number;
  column?: number;
  type: MatchType;
  preview: string;
  rangeStart?: number;
  rangeEnd?: number;
}