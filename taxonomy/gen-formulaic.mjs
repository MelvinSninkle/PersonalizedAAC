// taxonomy/gen-formulaic.mjs
//
// Generates teaching descriptions for the FORMULAIC categories — Numbers,
// Alphabet, Colors, Shapes — from per-item facts + a template, then writes them
// to authored-descriptions-formulaic.json (apply-authored.mjs banks it).
// Deterministic, no OpenAI. Re-runnable.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSV = join(HERE, 'seed-core-v1.csv');
const OUT = join(HERE, 'authored-descriptions-formulaic.json');

function parseCSV(t){const R=[];let f=[],c='',q=false;for(let i=0;i<t.length;i++){const ch=t[i];
 if(q){if(ch==='"'){if(t[i+1]==='"'){c+='"';i++}else q=false}else c+=ch}
 else if(ch==='"')q=true;else if(ch===','){f.push(c);c=''}else if(ch==='\n'){f.push(c);R.push(f);f=[];c=''}else if(ch==='\r'){}else c+=ch}
 if(c!==''||f.length){f.push(c);R.push(f)}return R}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---- number -> word (1..100) ----
const ONES = ['','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const TENS = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
function numWord(n){ if(n===100) return 'one hundred'; if(n<20) return ONES[n]; return TENS[Math.floor(n/10)] + (n%10 ? '-'+ONES[n%10] : ''); }
function numberDesc(n){
  const w = numWord(n), W = cap(w);
  if(n===1) return [`${W} is the number 1.`, 'It is the very first counting number, right before two.', 'You can count to one or hold up one finger.'];
  if(n===100) return ['One hundred is the number 100.', 'It comes after ninety-nine — it is ten tens all together.', 'One hundred is a lot! You count to one hundred when you count a big group.'];
  const prev = cap(numWord(n-1)), next = cap(numWord(n+1));
  if(n<=10) return [`${W} is the number ${n}.`, `It comes after ${prev.toLowerCase()} and before ${next.toLowerCase()}.`, `You can count to ${n} or hold up ${n} fingers.`];
  return [`${W} is the number ${n}.`, `It comes after ${prev.toLowerCase()} and before ${next.toLowerCase()}.`, `${W} is a bigger number — you reach it when you count a lot.`];
}

// ---- letters ----
const LETTER = {
  A:['ah or ay','apple','ant'], B:['buh','ball','bear'], C:['kuh','cat','cup'], D:['duh','dog','duck'],
  E:['eh or ee','egg','elephant'], F:['fff','fish','fox'], G:['guh','goat','goose'], H:['huh','hat','hand'],
  I:['ih or eye','igloo','ice'], J:['juh','jam','jump'], K:['kuh','kite','key'], L:['lll','lion','leaf'],
  M:['mmm','mom','moon'], N:['nnn','nose','net'], O:['ah or oh','octopus','orange'], P:['puh','pig','pen'],
  Q:['kwuh','queen','quack'], R:['rrr','rabbit','red'], S:['sss','sun','snake'], T:['tuh','top','toe'],
  U:['uh or you','umbrella','up'], V:['vvv','van','violin'], W:['wuh','water','wave'], X:['ks','fox','box'],
  Y:['yuh','yes','yellow'], Z:['zzz','zebra','zoo'],
};
function letterDesc(L){ const [sound,e1,e2]=LETTER[L.toUpperCase()]; return [`${L} is a letter in the alphabet.`, `It makes the '${sound}' sound.`, `You can find ${L} in words like '${e1}' and '${e2}'.`]; }

// ---- colors ----
const COLOR = {
  red:['a fire truck','a strawberry'], blue:['the sky','the ocean'], green:['grass','a leaf'],
  yellow:['the sun','a banana'], orange:['an orange','a pumpkin'], purple:['a grape','a plum'],
  pink:['a flower','bubblegum'], black:['the night sky','a tire'], white:['snow','a cloud'],
  brown:['a tree trunk','chocolate'], gray:['an elephant','a rain cloud'], gold:['a shiny crown','a coin'],
  silver:['a spoon','a shiny key'], lime:['a lime','bright grass'], teal:['a peacock feather','shallow sea water'],
  navy:['a dark blue sky','blue jeans'], peach:['a peach','a sunset'], tan:['sand','a teddy bear'],
};
function colorDesc(c){ const [e1,e2]=COLOR[c.toLowerCase()]||['an apple','a leaf']; return [`${cap(c)} is a color you can see all around you.`, `Things like ${e1} and ${e2} are ${c}.`, `You can say 'I see ${c}!' or 'I want the ${c} one.'`]; }

// ---- shapes ----
const SHAPE = {
  circle:['is perfectly round with no corners','a ball or a wheel'],
  square:['has four equal sides and four corners','a window or a cracker'],
  triangle:['has three sides and three corners','a slice of pizza or a party hat'],
  rectangle:['has four sides — two long and two short','a door or a book'],
  oval:['is like a stretched-out circle, shaped like an egg','an egg'],
  diamond:['has four points and looks like a tilted square','a kite'],
  heart:['has two bumps on top and a point at the bottom','a valentine'],
  star:['has five pointy points','a star up in the sky'],
  crescent:['is a curved sliver','the moon at night'],
  hexagon:['has six straight sides','a honeycomb'],
  octagon:['has eight sides','a stop sign'],
  pentagon:['has five sides','a drawing of a house'],
  arrow:['is a line with a point that shows which way to go','a sign pointing the way'],
  cross:['has one line up-and-down and one line across','a plus sign'],
};
const aan = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
function shapeDesc(s){ const [feat,ex]=SHAPE[s.toLowerCase()]||['is a shape','many things']; return [`${cap(aan(s))} ${s} is a shape.`, `It ${feat}.`, `You can find ${aan(s)} ${s} in ${ex}.`]; }

const rows = parseCSV(readFileSync(CSV,'utf8'));
const H=rows[0], I=Object.fromEntries(H.map((h,i)=>[h,i]));
const out = {};
for(let r=1;r<rows.length;r++){
  const row=rows[r]; if(!row[0]) continue;
  const id=row[I.id], cat=(row[I.category]||'').trim(), label=(row[I.label]||'').trim();
  if(cat==='Numbers')      out[id]=numberDesc(parseInt(label,10));
  else if(cat==='Alphabet')out[id]=letterDesc(label);
  else if(cat==='Colors')  out[id]=colorDesc(label);
  else if(cat==='Shapes')  out[id]=shapeDesc(label);
}
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log('generated', Object.keys(out).length, 'formulaic descriptions ->', OUT.split('/').pop());
