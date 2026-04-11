import styles from './CodeBlock.module.css';

interface InlineCodeProps {
  children: string;
}

export function InlineCode({ children }: InlineCodeProps) {
  return <code className={styles.inlineCode}>{children}</code>;
}
