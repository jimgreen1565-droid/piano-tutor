// 生成正确的采样下载脚本，并删除早期写错的版本
import { writeFileSync, rmSync, existsSync } from 'node:fs';

const names = [];
for (let o = 0; o <= 7; o++) names.push(`A${o}`); // A0..A7
for (let o = 1; o <= 8; o++) names.push(`C${o}`); // C1..C8
for (const l of ['Ds', 'Fs']) for (let o = 1; o <= 7; o++) names.push(`${l}${o}`);

const lines = [
  '@echo off',
  'rem Salamander Grand Piano 采样（Alexander Holm, CC-BY 3.0）',
  'rem 注意：升号音文件名是 Ds/Fs，不是 D#/F#；用 %23 编码会拿到 9379B 的 404 HTML 页',
  'rem 注意：A8 不存在（高位最高到 C8），C0 也不存在',
  'cd /d "%~dp0"',
  'mkdir public\\samples\\piano 2>nul',
  ...names.map(
    (n) =>
      `curl -s --max-time 40 -o public\\samples\\piano\\${n}.mp3 "https://tonejs.github.io/audio/salamander/${n}.mp3"`
  ),
  'echo DONE',
];

writeFileSync('dl.bat', lines.join('\r\n') + '\r\n');
if (existsSync('dl2.bat')) rmSync('dl2.bat');
console.log('dl.bat 重写完成，条目数', names.length);
