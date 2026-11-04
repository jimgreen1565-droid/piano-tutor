import { appendFileSync, readFileSync } from 'node:fs';

const css = `
/* ---------- 老师点评（语音指导） ---------- */

.coach-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}

.coach-bar .btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 13px;
  min-height: 36px;
}

.coach-lines {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 240px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.coach-line {
  position: relative;
  padding: 8px 10px 8px 12px;
  border-left: 2px solid var(--border);
  font-size: 14px;
  line-height: 1.6;
  color: var(--text);
  transition: background 0.15s ease;
}

.coach-line + .coach-line {
  margin-top: 6px;
}

.coach-line.kind-praise {
  border-left-color: var(--success);
}
.coach-line.kind-issue {
  border-left-color: var(--danger);
}
.coach-line.kind-drill {
  border-left-color: var(--primary);
}
.coach-line.kind-caution {
  border-left-color: var(--warning);
}

/* 正在念的这一句：靠左边条加粗 + 底色，不用大色块（避免"异常"失去信号强度） */
.coach-line.on {
  background: var(--card-solid);
  border-left-width: 4px;
}

.coach-kind {
  display: inline-block;
  margin-right: 8px;
  font-size: 11px;
  line-height: 16px;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  color: var(--muted, #6b7280);
  vertical-align: 1px;
  white-space: nowrap;
}

.coach-line.kind-issue .coach-kind {
  color: var(--danger);
  border-color: var(--danger);
}
.coach-line.kind-praise .coach-kind {
  color: var(--success);
  border-color: var(--success);
}
.coach-line.kind-drill .coach-kind {
  color: var(--primary);
  border-color: var(--primary);
}

.coach-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: center;
  margin-top: 10px;
}

.coach-auto {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--muted, #6b7280);
  min-height: 32px;
}

.coach-note {
  font-size: 12px;
  color: var(--muted, #6b7280);
  line-height: 1.5;
}

@media (max-width: 520px) {
  .coach-bar .btn span {
    display: inline;
  }
  .coach-lines {
    max-height: 200px;
  }
}
`;

const file = 'src/style.css';
const before = readFileSync(file, 'utf8');
if (before.includes('.coach-bar')) {
  console.log('already has coach css, skip');
} else {
  appendFileSync(file, css);
  console.log('appended coach css, file now', readFileSync(file, 'utf8').length, 'chars');
}
