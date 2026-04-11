interface AboutCardProps {
  version: string;
}

export function AboutCard({ version }: AboutCardProps) {
  return (
    <div className="settings-card about">
      <h3>ℹ️ 关于</h3>
      <div className="about-info">
        <div>Local thinking v{version}</div>
        <div className="tech-stack">Rust + Tauri 2.0 + llama.cpp</div>
      </div>
    </div>
  );
}
