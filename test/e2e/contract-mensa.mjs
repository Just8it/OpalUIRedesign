// Opt-in network check. Never imported by the offline suite.
import assert from 'node:assert/strict';
const origin='https://api.studentenwerk-dresden.de/openmensa/v2';
async function get(path) { const r=await fetch(origin+path,{signal:AbortSignal.timeout(15000)}); assert.ok(r.ok, `${r.status} ${r.url}`); return r.json(); }
const days=await get('/canteens/4/days'); assert.ok(Array.isArray(days),'days must be an array');
let checked=0;
for(const day of days.filter(d=>!d.closed).slice(0,7)) {
 const meals=await get(`/canteens/4/days/${day.date}/meals`); assert.ok(Array.isArray(meals));
 for(const meal of meals) { assert.equal(typeof meal.name,'string'); assert.ok(Array.isArray(meal.notes)); assert.ok(meal.prices && typeof meal.prices==='object'); for(const key of ['Studierende','Bedienstete']) assert.ok(typeof meal.prices[key]==='number' || meal.prices[key]===null,`Missing/invalid prices.${key}: ${JSON.stringify(meal)}`); checked++; }
}
assert.ok(checked>0,'No meals available: contract was not verified'); console.log(`Mensa contract verified: ${checked} meals`);
