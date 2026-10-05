import { expect, it } from 'vitest';
import { displayNickname } from './auth';
it.each([undefined,null,42,{},[],{username:'alice'},true,'','я'.repeat(30)])('safely renders untrusted profile metadata %j',(value)=>{
 expect(displayNickname(value)).toBe('Мій облік');
});
it('normalizes a valid display nickname',()=>expect(displayNickname(' ALICE_7 ')).toBe('alice_7'));
