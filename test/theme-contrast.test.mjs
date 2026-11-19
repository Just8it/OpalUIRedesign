import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveAccentTokens, PRESETS } from '../src/theme.ts';
const lum = hex => hex.slice(1).match(/../g).map(v => parseInt(v,16)/255).map(v => v<=.03928?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
for (const [mode, base] of Object.entries(PRESETS)) {
    for (const accent of ['#2f6fe4','#ffff00','#e02020','#20b050','#8020c0','#030405']) {
        test(`${mode} ${accent} accent text meets AA on all opaque surfaces`, () => {
            const a = lum(deriveAccentTokens(accent,base)['accent-text']);
            for (const key of ['bg','surface','surface-2','surface-3']) {
                const b = lum(base[key]);
                assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,key);
            }
        });
    }
}
