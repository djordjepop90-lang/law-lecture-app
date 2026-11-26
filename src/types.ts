export interface PageText {
  index: number; // 1-based page/slide number
  text: string;
  wordCount: number;
}

export interface SourceDocument {
  id: string;
  name: string;
  kind: 'pdf' | 'pptx';
  pages: PageText[];
  totalWords: number;
  scanned: boolean;
  language: 'en' | 'de' | 'fr' | 'unknown';
  uploadedAt: number;
}

export interface Chapter {
  id: string;
  title: string;
  pageStart: number; // 1-based inclusive
  pageEnd: number; // 1-based inclusive
  wordCount: number;
}

export type LayoutType = 'LEGAL_TEST' | 'CASE_COMPARISON' | 'TREATY_DIAGRAM' | 'KEY_TAKEAWAYS';

export interface LegalTestStep {
  label: string;
  criterion: string;
  burdenOfProof?: string;
  authority?: string;
}

export interface CaseInfo {
  name: string;
  court: string;
  year: string;
  parties: string;
  facts: string;
  issue: string;
  holding: string;
  ratio: string;
}

export interface TreatyNode {
  id: string;
  label: string;
  kind: 'norm' | 'exception' | 'obligation';
}

export interface TreatyEdge {
  from: string;
  to: string;
  label: string;
}

export interface GlossaryTerm {
  term: string;
  definition: string;
}

export interface Scene {
  id: string;
  title: string;
  layoutType: LayoutType;
  narration: string; // 180-260 words, spoken lecture style
  citations: string[];
  sourcePages: number[];
  layoutData:
    | { steps: LegalTestStep[] }
    | { cases: CaseInfo[] }
    | { nodes: TreatyNode[]; edges: TreatyEdge[] }
    | { takeaways: string[]; examTraps: { trap: string; correction: string }[] };
  glossaryTerms: GlossaryTerm[];
}

export interface Storyboard {
  chapterId: string;
  scenes: Scene[];
  generatedAt: number;
}

export interface Outline {
  chapterId: string;
  keyConcepts: string[];
  articles: string[];
  cases: string[];
  summary: string;
}

export type LanguageCode = 'en' | 'de' | 'fr';

export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: 'English',
  de: 'German (Deutsch)',
  fr: 'French (Français)',
};
