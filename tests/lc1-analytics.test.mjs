import test from 'node:test';
import assert from 'node:assert/strict';
import {analyticsPalette,analyticsStyle,registryCountChart} from '../src/analytics/palette.js';
const luminance=h=>{const [r,g,b]=h.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b};
const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
test('brand-neutral charts and comparison palette in both themes',()=>{
 for(const dark of [false,true]){const p=analyticsPalette(dark);assert.equal(p.actual,p.categorical[0]);assert.equal(p.comparison,p.categorical[1]);for(const c of p.categorical)assert(![p.critical,p.compliant,p.risk,p.attention].includes(c));assert.notEqual(p.actual,'#E30613')}
});
test('meaningful explicit state colors and readable markers',()=>{
 for(const dark of [false,true]){const p=analyticsPalette(dark);for(const key of ['actual','comparison','compliant','attention','risk','critical','plan']){const s=analyticsStyle(key,dark);assert.equal(s.color,p[key]);assert(s.label.length>0);assert(contrast(s.color,p.surface)>=3,key)}
 assert.equal(analyticsStyle('critical',dark).marker,'!');assert.equal(analyticsStyle('compliant',dark).marker,'✓')}
 assert.equal(analyticsStyle('critical').color,'#E30613');assert.throws(()=>analyticsStyle('75%'),RangeError);
});
test('plan, unassessed and not applicable stay visually and semantically distinct',()=>{
 for(const dark of [false,true]){const p=analyticsPalette(dark),plan=analyticsStyle('plan',dark),unknown=analyticsStyle('not_assessed',dark),na=analyticsStyle('not_applicable',dark);assert.notEqual(plan.pattern,unknown.pattern);assert.notEqual(unknown.pattern,na.pattern);assert.notEqual(unknown.marker,na.marker);assert(contrast(unknown.borderColor,p.surface)>=3);assert.notEqual(unknown.label,analyticsStyle('critical',dark).label)}
});
test('registry chart uses actual data and theme palette, not severity',()=>{
 for(const dark of [false,true]){const p=analyticsPalette(dark),o=registryCountChart(['A','B'],[0,2],dark);assert.equal(o.series[0].itemStyle.color,p.actual);assert.deepEqual(o.series[0].data,[0,2]);assert.match(o.aria.description,/A — 0/);assert.match(o.aria.description,/B — 2/);assert.equal(o.xAxis.minInterval,1);assert.notEqual(o.series[0].itemStyle.color,p.critical)}
 assert.throws(()=>registryCountChart(['A'],[null]),TypeError);assert.throws(()=>registryCountChart(['A'],[-1]),TypeError);assert.throws(()=>registryCountChart(['A'],[]),TypeError)
});
test('shared palette is immutable',()=>{assert.throws(()=>{analyticsPalette().actual='#E30613'},TypeError);assert.throws(()=>analyticsPalette(true).categorical.push('#fff'),TypeError)});
