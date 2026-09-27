import { useState } from 'react';
import { mergeRestPeriods } from './schedule';
import { CrewScheduleResult, CycleInfo, Project, RestPeriod } from './types';
import { CyclePath } from './SidePanel';

interface CrewPanelProps {
  project: Project;
  /** 班组排程结果（随编辑实时重算） */
  result: CrewScheduleResult | null;
  /** 当前图的环依赖（存在时停止输出班组结果，仅展示成环路径） */
  cycle?: CycleInfo;
  onAddRestPeriod: (period: RestPeriod) => void;
  onUpdateRestPeriod: (id: string, patch: { start?: number; end?: number }) => void;
  onDeleteRestPeriod: (id: string) => void;
}

/**
 * 班组排程面板：按班组人数容量约束生成的不抢占可行排程，
 * 列出每条口令的排定起止与总工期；并提供相对零点的休息时段录入/修改/删除。
 * 有环时口令排程停止输出（成环路径见下），休息时段仍可编辑并随项目保存。
 */
export function CrewPanel(props: CrewPanelProps) {
  const { project, result, cycle } = props;
  const [collapsed, setCollapsed] = useState(false);

  const capacity = project.crewSize ?? 1;
  const restPeriods = project.restPeriods ?? [];
  // 合并结果在面板本地计算：有环、排程未输出时也能如实展示零容量区间
  const restIntervals = mergeRestPeriods(restPeriods);
  const nodeById = new Map(project.nodes.map((n) => [n.id, n]));
  // 展示按（开始时刻, 口令 ID）排序；排定顺序允许后排者填入空档
  const rows = result?.ok
    ? [...result.assignments].sort((a, b) =>
        a.start !== b.start ? a.start - b.start : a.nodeId < b.nodeId ? -1 : 1,
      )
    : [];

  const addRest = () => {
    // 新增时段默认接在现有休息（合并后）之后 10s，避免一录入就与已有时段交叠
    const lastEnd = restIntervals.reduce((m, r) => Math.max(m, r.end), 0);
    props.onAddRestPeriod({ id: crypto.randomUUID(), start: lastEnd, end: lastEnd + 10 });
  };

  return (
    <section className="crew-panel">
      <header className="crew-panel-head">
        <h2>班组排程</h2>
        <span className="crew-meta">班组人数 {capacity} 人</span>
        {result?.ok && project.nodes.length > 0 && (
          <span className="crew-meta">总工期 {round1(result.makespan)}s</span>
        )}
        {cycle && <span className="crew-meta crew-meta-cycle">存在环依赖，已停止输出</span>}
        <span className="spacer" />
        <button className="crew-toggle" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? '展开 ▾' : '收起 ▴'}
        </button>
      </header>
      {!collapsed && (
        <div className="crew-panel-body">
          <RestEditor
            restPeriods={restPeriods}
            merged={restIntervals}
            onAdd={addRest}
            onUpdate={props.onUpdateRestPeriod}
            onDelete={props.onDeleteRestPeriod}
          />
          {cycle ? (
            <>
              <p className="hint overrun-hint">
                当前口令图存在环依赖，班组排程已停止输出；请先解除成环约束。
              </p>
              <CyclePath project={project} cycle={cycle} />
            </>
          ) : !result || rows.length === 0 ? (
            <p className="hint">暂无可排口令，请先添加口令。</p>
          ) : (
            <>
              <table className="crew-table">
                <thead>
                  <tr>
                    <th>口令</th>
                    <th>开始</th>
                    <th>结束</th>
                    <th>用人数</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => {
                    const n = nodeById.get(a.nodeId);
                    return (
                      <tr key={a.nodeId}>
                        <td>{n?.name ?? a.nodeId}</td>
                        <td>{round1(a.start)}s</td>
                        <td>{round1(a.end)}s</td>
                        <td>{n?.crew ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="hint">
                共 {rows.length} 条口令，总工期 {round1(result.makespan)}s
                （容量 {capacity} 人，占用按 [开始, 结束) 计算，零时长不占人）。
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------- 休息时段编辑 ----------------

interface RestEditorProps {
  restPeriods: RestPeriod[];
  /** 交叠/相邻时段合并后实际生效的零容量半开区间 */
  merged: { start: number; end: number }[];
  onAdd: () => void;
  onUpdate: (id: string, patch: { start?: number; end?: number }) => void;
  onDelete: (id: string) => void;
}

function RestEditor(props: RestEditorProps) {
  const { restPeriods, merged } = props;
  const didMerge = merged.length < restPeriods.length;
  return (
    <div className="rest-editor">
      <div className="rest-editor-head">
        <h3>休息时段</h3>
        <button className="rest-add" onClick={props.onAdd}>
          ＋ 添加休息
        </button>
      </div>
      {restPeriods.length === 0 ? (
        <p className="hint">暂无休息时段；需用人的正时长口令可在全时段排程。</p>
      ) : (
        <table className="rest-table">
          <thead>
            <tr>
              <th>起点（秒）</th>
              <th>终点（秒）</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {restPeriods.map((r) => (
              <RestRow key={r.id} period={r} onUpdate={props.onUpdate} onDelete={props.onDelete} />
            ))}
          </tbody>
        </table>
      )}
      {merged.length > 0 && (
        <p className="hint rest-merged">
          排程生效的零容量区间（半开）：
          {merged.map((iv) => `[${round1(iv.start)}, ${round1(iv.end)})`).join('、')}
          {didMerge && `（${restPeriods.length} 条交叠或相邻时段已合并为 ${merged.length} 个）`}
        </p>
      )}
      <p className="hint">
        时刻相对排程零点；需用人的正时长口令完整避开休息时段，零时长或用人数为 0 的口令仍可在休息时段内按前置时刻执行。
      </p>
    </div>
  );
}

interface RestRowProps {
  period: RestPeriod;
  onUpdate: (id: string, patch: { start?: number; end?: number }) => void;
  onDelete: (id: string) => void;
}

/**
 * 单条休息时段的编辑行：输入先在本地成草稿，合法（有限数且 0 ≤ 起点 < 终点）后实时写入，
 * 随项目防抖保存；非法输入仅红框提示，不写入。
 * 行以时段 id 为 key，草稿只在本行内维护，避免输入中间态（如 “5.”）被外部值回写打断。
 */
function RestRow(props: RestRowProps) {
  const { period } = props;
  const [draft, setDraft] = useState({ start: String(period.start), end: String(period.end) });

  const start = Number(draft.start);
  const end = Number(draft.end);
  const startValid = draft.start.trim() !== '' && Number.isFinite(start) && start >= 0;
  const endValid = draft.end.trim() !== '' && Number.isFinite(end);
  const orderValid = startValid && endValid && start < end;

  const commit = (field: 'start' | 'end', raw: string) => {
    const next = { ...draft, [field]: raw };
    setDraft(next);
    const s = Number(next.start);
    const e = Number(next.end);
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || s >= e) return;
    props.onUpdate(period.id, field === 'start' ? { start: s } : { end: e });
  };

  return (
    <tr>
      <td>
        <input
          type="number"
          min={0}
          step={0.5}
          value={draft.start}
          className={startValid && orderValid ? '' : 'rest-input-invalid'}
          onChange={(e) => commit('start', e.target.value)}
        />
      </td>
      <td>
        <input
          type="number"
          min={0}
          step={0.5}
          value={draft.end}
          className={endValid && orderValid ? '' : 'rest-input-invalid'}
          onChange={(e) => commit('end', e.target.value)}
        />
      </td>
      <td>
        <button className="rest-del" title="删除该休息时段" onClick={() => props.onDelete(period.id)}>
          删除
        </button>
      </td>
    </tr>
  );
}

function round1(v: number): string {
  return (Math.round(v * 10) / 10).toString();
}
