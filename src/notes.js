// 声学钢琴转录后处理
//
// Basic Pitch 对真实钢琴（尤其原声琴）会把泛音也识别成音符，
// 典型表现：同一次按键在 1~2 个八度处多出一个短音；
// 另有点击噪声导致的同名音重复触发。
// 这里做两步收敛，只为「别把泛音算成错音」，不改动真实演奏内容。

const SAME_PITCH_WINDOW = 0.12; // 同名音重复触发窗口（秒）
const OCTAVE_WINDOW = 0.14; // 八度泛音窗口（秒）
const SCAN_BACK = 0.25; // 只回看最近 0.25 秒内的音符

const strength = (n) => (n.durationSeconds || 0) * ((n.amplitude || 0) + 0.05);

export function cleanNotes(notes) {
  const sorted = [...notes].sort(
    (a, b) => a.startTimeSeconds - b.startTimeSeconds,
  );
  const kept = [];

  for (const n of sorted) {
    let drop = false;

    for (let i = kept.length - 1; i >= 0; i--) {
      const k = kept[i];
      const dt = n.startTimeSeconds - k.startTimeSeconds;
      if (dt > SCAN_BACK) break;

      const interval = Math.abs(n.pitchMidi - k.pitchMidi);

      // 同名音重复触发：留更"结实"的那个（时值长 / 力度大）
      if (interval === 0 && dt < SAME_PITCH_WINDOW) {
        if (strength(n) > strength(k)) {
          kept.splice(i, 1);
          break;
        }
        drop = true;
        break;
      }

      // 一/两个八度的泛音误检：同样留更结实的那个
      if ((interval === 12 || interval === 24) && dt < OCTAVE_WINDOW) {
        if (strength(n) > strength(k)) {
          kept.splice(i, 1);
          break;
        }
        drop = true;
        break;
      }
    }

    if (!drop) kept.push(n);
  }

  return kept;
}
