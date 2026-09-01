import { useEffect, useState } from "react";
import type { PublicSkillDiscoveryResult } from "../../shared/skills";

const emptySkillResult: PublicSkillDiscoveryResult = {
  skills: [],
  errors: [],
};

export function SkillLibraryPanel() {
  const [result, setResult] = useState<PublicSkillDiscoveryResult>(
    emptySkillResult,
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!window.buildingAgent) {
      setResult({
        skills: [],
        errors: [
          {
            folderName: "preview",
            message: "需要桌面桥接能力才能扫描本地技能。",
          },
        ],
      });
      setLoading(false);
      return;
    }

    window.buildingAgent
      .listSkills()
      .then(setResult)
      .catch((error) => {
        setResult({
          skills: [],
          errors: [
            {
              folderName: "skills",
              message:
                error instanceof Error
                  ? error.message
                  : "无法加载技能。",
            },
          ],
        });
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <section className="skill-library">
      <div className="settings-header">
        <div>
          <p className="kicker">本地 SKILL.md</p>
          <h3>本地技能库</h3>
        </div>
        <span className="settings-state is-idle">
          {loading ? "正在扫描" : `${result.skills.length} 个技能`}
        </span>
      </div>

      <div className="skill-grid">
        {result.skills.map((skill) => (
          <article className="skill-card" key={skill.manifest.name}>
            <div className="skill-card-header">
              <div>
                <span>{skill.manifest.execution.mode}</span>
                <h4>{skill.manifest.displayName}</h4>
              </div>
              <strong>v{skill.manifest.version}</strong>
            </div>
            <p>{skill.manifest.description}</p>
            <dl className="skill-meta">
              <div>
                <dt>输入项</dt>
                <dd>{skill.manifest.inputs.length}</dd>
              </div>
              <div>
                <dt>文件</dt>
                <dd>
                  {skill.manifest.permissions.files.read.length} 读 /{" "}
                  {skill.manifest.permissions.files.write.length} 写
                </dd>
              </div>
              <div>
                <dt>命令行</dt>
                <dd>
                  {skill.manifest.permissions.shell.commands.length
                    ? "已允许"
                    : "未允许"}
                </dd>
              </div>
            </dl>
            <code>{skill.rootDir}</code>
          </article>
        ))}
      </div>

      {result.errors.length ? (
        <div className="skill-errors">
          <strong>需要处理的技能</strong>
          {result.errors.map((error) => (
            <p key={error.folderName}>
              {error.folderName}: {error.message}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
