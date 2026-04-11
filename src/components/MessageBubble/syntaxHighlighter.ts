import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c';
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import php from 'react-syntax-highlighter/dist/esm/languages/prism/php';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import scala from 'react-syntax-highlighter/dist/esm/languages/prism/scala';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';

const SUPPORTED_LANGUAGES = {
  bash,
  c,
  cpp,
  csharp,
  css,
  docker,
  go,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  markup,
  php,
  python,
  ruby,
  rust,
  scala,
  sql,
  swift,
  typescript,
  yaml,
} as const;

const LANGUAGE_ALIASES: Record<string, keyof typeof SUPPORTED_LANGUAGES | undefined> = {
  dockerfile: 'docker',
  html: 'markup',
  plaintext: undefined,
  shell: 'bash',
  xml: 'markup',
};

let registered = false;

function registerLanguages() {
  if (registered) {
    return;
  }

  Object.entries(SUPPORTED_LANGUAGES).forEach(([name, language]) => {
    SyntaxHighlighter.registerLanguage(name, language);
  });

  registered = true;
}

export function normalizeCodeLanguage(language?: string): string | undefined {
  if (!language) {
    return undefined;
  }

  const normalizedLanguage = LANGUAGE_ALIASES[language] ?? language;
  return normalizedLanguage && normalizedLanguage in SUPPORTED_LANGUAGES
    ? normalizedLanguage
    : undefined;
}

registerLanguages();

export { SyntaxHighlighter };
