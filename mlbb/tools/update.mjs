// Collects MLBB stats from the community Rone Arena API (arena.rone.dev)
// and writes ../data.json (stats, builds, counters) and ../img.json (icons as data URIs).
// Usage: node update.mjs            (uses cache for hero details < 7 days old)
//        node update.mjs --fresh    (ignores cache)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
const CACHE = path.join(HERE, '.cache');
const API = 'https://arena.rone.dev/api';
const UA = 'MLBB-Counter-Lab/0.2 (personal fan project)';
const FRESH = process.argv.includes('--fresh');
const RANKS = [
  { id: 'all', name: 'Все ранги' },
  { id: 'epic', name: 'Эпик' },
  { id: 'legend', name: 'Легенда' },
  { id: 'mythic', name: 'Мифик' },
  { id: 'honor', name: 'Мифическая честь' },
  { id: 'glory', name: 'Мифическая слава' }
];
const DAYS = '7';
const LANE_KEY = { 'exp lane': 'exp', 'mid lane': 'mid', 'roam': 'roam', 'jungle': 'jungle', 'gold lane': 'gold' };
const CLASS_KEY = { tank: 'tank', fighter: 'fighter', assassin: 'assassin', mage: 'mage', marksman: 'marksman', support: 'support' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
await fs.mkdir(CACHE, { recursive: true });

async function get(p, { cacheKey, maxAgeH = 0 } = {}) {
  const file = cacheKey && path.join(CACHE, cacheKey.replace(/[^a-z0-9_-]/gi, '_') + '.json');
  if (file && !FRESH && maxAgeH > 0) {
    try {
      const s = await fs.stat(file);
      if (Date.now() - s.mtimeMs < maxAgeH * 3600e3) return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {}
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(API + p, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (r.status === 429 || r.status >= 500) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.code !== 0) throw new Error(`API ${p}: ${j.message || j.code} ${JSON.stringify(j.details || '').slice(0, 200)}`);
      if (file) await fs.writeFile(file, JSON.stringify(j));
      await sleep(150);
      return j;
    } catch (e) {
      if (attempt === 4 || /API /.test(e.message)) throw e;
      await sleep(800 * attempt);
    }
  }
}
async function pool(list, n, fn) {
  const out = new Array(list.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); } }));
  return out;
}
const recs = j => (j && j.data && j.data.records) || [];
const r3 = v => Math.round(v * 1000) / 10; // 0.523 -> 52.3
const slug = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');

console.log('1/6 героев…');
const list = recs(await get('/heroes?size=300&index=1&lang=en'));
const base = list.map(r => ({ hid: r.data.hero_id, en: r.data.hero.data.name, head: r.data.hero.data.head, rel: r.data.relation }));
console.log('   героев:', base.length);
const patchMatch = (base[0]?.head || '').match(/homepage_(\d+)_(\d+)_(\d+)/);
const patch = patchMatch ? `${patchMatch[1]}.${patchMatch[2]}.${patchMatch[3]}` : null;

console.log('2/6 статистика по рангам…');
const stats = {}; // hid -> rank -> [wr, pr, br]
for (const rk of RANKS) {
  const rows = recs(await get(`/heroes/rank?days=${DAYS}&rank=${rk.id}&sort_field=pick_rate&sort_order=desc&size=300&index=1`));
  for (const r of rows) {
    const d = r.data;
    (stats[d.main_heroid] ||= {})[rk.id] = [r3(d.main_hero_win_rate), Math.round(d.main_hero_appearance_rate * 10000) / 100, r3(d.main_hero_ban_rate)];
  }
  console.log(`   ${rk.id}: ${rows.length}`);
}

console.log('3/6 карточки героев (ru)…');
const details = await pool(base, 4, async b => {
  const j = await get(`/heroes/${b.hid}?lang=ru`, { cacheKey: `hero_${b.hid}_ru`, maxAgeH: 24 * 7 });
  return recs(j)[0]?.data;
});

console.log('4/6 контрпики и билды…');
const extra = await pool(base, 4, async (b, k) => {
  const h = details[k]?.hero?.data || {};
  let lanes = (h.roadsort || []).map(x => LANE_KEY[String(x?.data?.road_sort_title).toLowerCase()]).filter(Boolean);
  let counters = null, builds = [];
  try { counters = recs(await get(`/heroes/${b.hid}/counters?days=${DAYS}&rank=all&size=20&index=1`))[0]?.data; } catch (e) { console.warn('   counters', b.en, e.message); }
  const tryLane = async ln => {
    try { return recs(await get(`/academy/heroes/${b.hid}/builds?rank=all&lane=${ln}&size=20&index=1`))[0]?.data?.build || []; }
    catch (e) { return []; }
  };
  if (lanes[0]) builds = await tryLane(lanes[0]);
  if (!lanes.length) {
    // lane missing in the hero card: probe every lane and keep the one with the most popular builds
    let best = { ln: null, b: [], pr: 0 };
    for (const ln of ['exp', 'jungle', 'mid', 'gold', 'roam']) {
      const bl = await tryLane(ln);
      const pr = bl.reduce((s, x) => s + (x.build_pick_rate || 0), 0);
      if (bl.length && pr > best.pr) best = { ln, b: bl, pr };
    }
    if (best.ln) { lanes = [best.ln]; builds = best.b; }
  }
  const byLane = {};
  if (lanes[0]) byLane[lanes[0]] = builds;
  for (const ln of lanes.slice(1)) byLane[ln] = await tryLane(ln);
  let compat = null, trend = [];
  try { compat = recs(await get(`/heroes/${b.hid}/compatibility?days=${DAYS}&rank=all&size=20&index=1`))[0]?.data; } catch (e) { console.warn('   compat', b.en, e.message); }
  try { trend = recs(await get(`/heroes/${b.hid}/trends?rank=all&past-days=30&size=20&index=1`))[0]?.data?.win_rate || []; } catch (e) { console.warn('   trends', b.en, e.message); }
  if ((k + 1) % 20 === 0) console.log(`   ${k + 1}/${base.length}`);
  return { lanes, counters, builds, byLane, compat, trend };
});

console.log('5/6 предметы, заклинания, эмблемы…');
const equip = recs(await get('/academy/equipment/expanded?size=300&index=1&lang=en'));
const spells = recs(await get('/academy/spells?size=50&index=1&lang=en'));
const emblems = recs(await get('/academy/emblems?size=100&index=1&lang=en'));
// player rank table: rank_level (accumulated stars) -> rank name
const RANK_RU = { 1: 'Воин', 2: 'Элита', 3: 'Мастер', 4: 'Грандмастер', 5: 'Эпик', 6: 'Легенда' };
const MYTHIC_RU = { '神话': 'Мифический', '百战神话': 'Мифическая честь', '至尊神话': 'Мифическая слава', '荣耀神话': 'Мифический бессмертный' };
const rankRecs = recs(await get('/academy/ranks?size=60&index=1&lang=en'));
const rankTable = rankRecs.map(r => r.data).sort((a, b) => a.rankid_start - b.rankid_start).map((d, i) => ({
  start: d.rankid_start, end: d.rankid_end,
  name: d.bigrank === 7 ? (MYTHIC_RU[d.bigrank_name] || 'Мифический') : (RANK_RU[d.bigrank] || d.bigrank_name),
  sub: d.minrank_name || '', big: d.bigrank, icon: d.icon, key: 'r:' + i
}));

const ITEM_TYPE = { Attack: 'phys', Magic: 'magic', Defense: 'def', Movement: 'boots', Roam: 'boots', Jungle: 'boots' };
const items = {};
for (const r of equip) {
  const d = r.data;
  items[d.equipid] = {
    name: d.equipname, cat: ITEM_TYPE[d.equiptypename] || 'def', type: d.equiptypename,
    desc: String(d.equiptips || '').replace(/<br\s*\/?>/gi, ', ').replace(/<[^>]+>/g, '').replace(/,\s*$/, '').trim(),
    icon: d.equipicon
  };
}
const spellById = {}; for (const r of spells) { const d = r.data.__data || {}; spellById[d.skillid] = { name: d.skillname, icon: d.skillicon }; }
const talentById = {}; for (const r of emblems) { const d = r.data; if (d.emblemskill) talentById[d.giftid] = { name: d.emblemskill.skillname, icon: d.emblemskill.skillicon, tier: d.gifttiers }; }
const emblemById = {};
const laneIcon = {}, classIcon = {}, skillIcon = {};

// hero assembly
const byHid = {};
const heroes = base.map((b, k) => {
  const d = details[k] || {}, h = d.hero?.data || {}, x = extra[k];
  const cls = (h.sortid || []).map(s => CLASS_KEY[String(s?.data?.sort_title).toLowerCase()]).filter(Boolean);
  const tagCount = {};
  for (const grp of h.heroskilllist || []) for (const s of grp.skilllist || []) for (const t of s.skilltag || []) tagCount[t.tagname] = (tagCount[t.tagname] || 0) + 1;
  const conv = arr => (arr || []).filter(bd => bd.equipid?.length).map(bd => {
    if (bd.emblem?.data) emblemById[bd.emblem.data.emblemid] = { name: bd.emblem.data.emblemname, icon: bd.emblem.data.attriicon };
    return {
      items: bd.equipid, wr: r3(bd.build_win_rate), pr: r3(bd.build_pick_rate),
      spell: bd.battleskill?.data?.battleskillid || bd.skillid, emblem: bd.emblem?.data?.emblemid, talents: bd.new_rune_skill || []
    };
  }).sort((a, b) => b.pr - a.pr);
  const builds = conv(x.builds);
  const buildsByLane = Object.fromEntries(Object.entries(x.byLane || {}).map(([ln, arr]) => [ln, conv(arr).slice(0, 3)]).filter(([, v]) => v.length));
  // lane / class icons (official)
  for (const r of h.roadsort || []) { const k2 = LANE_KEY[String(r?.data?.road_sort_title).toLowerCase()]; if (k2 && r.data.road_sort_icon) laneIcon[k2] ||= r.data.road_sort_icon; }
  for (const r of h.sortid || []) { const k2 = CLASS_KEY[String(r?.data?.sort_title).toLowerCase()]; if (k2 && r.data.sort_icon) classIcon[k2] ||= r.data.sort_icon; }
  // skills: index 0 is usually the passive
  const skills = (h.heroskilllist?.[0]?.skilllist || []).map(s => {
    skillIcon[s.skillid] = s.skillicon;
    return {
      id: s.skillid, name: s.skillname, cd: String(s['skillcd&cost'] || '').replace(/\s+/g, ' ').trim(),
      desc: String(s.skilldesc || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 420),
      tags: (s.skilltag || []).map(t => t.tagname)
    };
  });
  const c = x.counters || {};
  const cp = x.compat || {};
  const out = {
    hid: b.hid, id: slug(b.en), en: b.en, name: h.name || b.en,
    class: cls[0] || 'fighter', classes: cls, lane: x.lanes[0] || 'exp', lanes: x.lanes,
    speciality: h.speciality || [], difficulty: Number(h.difficulty || 0),
    head: h.squarehead || h.head || b.head,
    tags: tagCount,
    stats: stats[b.hid] || {},
    // sub_hero: enemies with the biggest win-rate gain against this hero (they counter it)
    weakTo: (c.sub_hero || []).map(s => ({ hid: s.heroid, wr: r3(s.hero_win_rate), delta: r3(s.increase_win_rate) })),
    // sub_hero_last: enemies that do worst against this hero
    strongVs: (c.sub_hero_last || []).map(s => ({ hid: s.heroid, wr: r3(s.hero_win_rate), delta: r3(s.increase_win_rate) })),
    rel: { strong: b.rel?.strong?.target_hero_id || [], weak: b.rel?.weak?.target_hero_id || [], assist: b.rel?.assist?.target_hero_id || [] },
    builds: builds.slice(0, 3),
    buildsByLane,
    skills,
    skillOrder: (h.recommendlevel || []).map(Number).filter(n => n > 0),
    // compatibility: best / worst teammates
    mates: (cp.sub_hero || []).map(s => ({ hid: s.heroid, wr: r3(s.hero_win_rate), delta: r3(s.increase_win_rate) })),
    badMates: (cp.sub_hero_last || []).map(s => ({ hid: s.heroid, wr: r3(s.hero_win_rate), delta: r3(s.increase_win_rate) })),
    trend: (x.trend || []).map(t => [t.date, r3(t.win_rate), Math.round(t.app_rate * 10000) / 100, r3(t.ban_rate)]).sort((a, b) => a[0] < b[0] ? -1 : 1)
  };
  byHid[b.hid] = out;
  return out;
}).filter(h => Object.keys(h.stats).length);

// hid -> slug ids for the page
for (const h of heroes) {
  const map = arr => arr.map(e => typeof e === 'number' ? byHid[e]?.id : (byHid[e.hid] ? { ...e, id: byHid[e.hid].id, hid: undefined } : null)).filter(Boolean);
  h.weakTo = map(h.weakTo); h.strongVs = map(h.strongVs);
  h.mates = map(h.mates); h.badMates = map(h.badMates);
  h.rel = { strong: map(h.rel.strong), weak: map(h.rel.weak), assist: map(h.rel.assist) };
}
// damage type from the hero's own build
for (const h of heroes) {
  const ids = h.builds.flatMap(b => b.items);
  const m = ids.filter(i => items[i]?.cat === 'magic').length, p = ids.filter(i => items[i]?.cat === 'phys').length;
  h.dmg = m > p ? 'magic' : p > m ? 'phys' : (['mage', 'support'].includes(h.class) ? 'magic' : 'phys');
  h.range = ['marksman', 'mage'].includes(h.class) ? 'ranged' : 'melee';
}

// counter items used by the matchup engine, resolved by English name
const COUNTER_NAMES = ['Sea Halberd', 'Glowing Wand', 'Dominance Ice', 'Wind of Nature', 'Winter Crown', 'Rose Gold Meteor',
  "Athena's Shield", 'Antique Cuirass', 'Blade Armor', 'Radiant Armor', 'Malefic Roar', 'Divine Glaive', 'Tough Boots', 'Warrior Boots', 'Immortality', 'Swift Boots', 'Arcane Boots', 'Magic Shoes', 'Rapid Boots', 'Demon Shoes', 'Blade of Despair', 'Holy Crystal', 'Brute Force Breastplate', 'Guardian Helmet', 'Hunter Strike'];
const counterItems = {};
for (const n of COUNTER_NAMES) {
  const id = Object.keys(items).find(k => items[k].name.toLowerCase() === n.toLowerCase());
  if (id) counterItems[n] = Number(id); else console.warn('   нет предмета:', n);
}

// keep only items that are referenced
const allBuilds = heroes.flatMap(h => [...h.builds, ...Object.values(h.buildsByLane).flat()]);
const used = new Set([...allBuilds.flatMap(b => b.items), ...Object.values(counterItems)].map(String));
const itemsOut = {};
// every item is kept: match history can contain any of them
for (const id of Object.keys(items)) { const { icon, ...rest } = items[id]; itemsOut[id] = rest; }
const spellsUsed = new Set([...allBuilds.map(b => b.spell), ...Object.keys(spellById).filter(k => spellById[k].name === 'Purify').map(Number)]);
const talentsUsed = new Set(allBuilds.flatMap(b => b.talents));

console.log('6/6 картинки…');
const img = {};
async function grab(key, url, w) {
  if (!url) return;
  const cf = path.join(CACHE, 'img_' + key.replace(/[^a-z0-9_-]/gi, '_') + '_' + Buffer.from(url).toString('base64url').slice(-24) + '.txt');
  try { img[key] = await fs.readFile(cf, 'utf8'); return; } catch {}
  const u = url + (url.includes('?') ? '&' : '?') + `w=${w}&h=${w}&fit=cover&output=webp&q=82`;
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      img[key] = 'data:image/webp;base64,' + buf.toString('base64');
      await fs.writeFile(cf, img[key]);
      return;
    } catch (e) { if (a === 3) console.warn('   картинка', key, e.message); else await sleep(600 * a); }
  }
}
const jobs = [
  ...heroes.map(h => ['h:' + h.id, h.head, 112]),
  ...Object.keys(items).map(id => ['i:' + id, items[id]?.icon, 80]),
  ...rankTable.map(r => [r.key, r.icon, 64]),
  ...[...spellsUsed].map(id => ['s:' + id, spellById[id]?.icon, 64]),
  ...[...talentsUsed].map(id => ['t:' + id, talentById[id]?.icon, 64]),
  ...Object.entries(emblemById).map(([id, e]) => ['e:' + id, e.icon, 64]),
  ...Object.entries(laneIcon).map(([k, u]) => ['l:' + k, u, 48]),
  ...Object.entries(classIcon).map(([k, u]) => ['c:' + k, u, 48]),
  ...Object.entries(skillIcon).map(([k, u]) => ['k:' + k, u, 56])
];
await pool(jobs, 6, ([k, u, w]) => grab(k, u, w));

for (const h of heroes) delete h.head;
const updated = new Date().toISOString();
const data = {
  version: 'rone-' + updated.slice(0, 16),
  patch: patch ? 'Патч ' + patch : 'Текущий патч',
  updated,
  days: Number(DAYS),
  source: { name: 'Rone Arena API', url: 'https://arena.rone.dev', note: 'Неофициальный API со статистикой из Moonton Academy' },
  ranks: RANKS,
  items: itemsOut,
  counterItems,
  spells: Object.fromEntries([...spellsUsed].filter(id => spellById[id]).map(id => [id, { name: spellById[id].name }])),
  talents: Object.fromEntries([...talentsUsed].filter(id => talentById[id]).map(id => [id, { name: talentById[id].name }])),
  rankTable: rankTable.map(({ icon, ...r }) => r),
  emblems: Object.fromEntries(Object.entries(emblemById).map(([id, e]) => [id, { name: e.name }])),
  heroes
};
await fs.writeFile(path.join(OUT, 'data.json'), JSON.stringify(data));
await fs.writeFile(path.join(OUT, 'img.json'), JSON.stringify(img));
const kb = async f => Math.round((await fs.stat(path.join(OUT, f))).size / 1024);
console.log(`Готово: ${heroes.length} героев, ${Object.keys(itemsOut).length} предметов, ${Object.keys(img).length} картинок. data.json ${await kb('data.json')} КБ, img.json ${await kb('img.json')} КБ. ${data.patch}`);
