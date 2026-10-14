import {it,expect} from 'vitest';
import {forgetDeletedSession} from './deleted-session';
function storage(owner:string){const items=new Map([['auth',JSON.stringify({user:{id:owner},access_token:'private-token'})],['finance-preferences','retained']]);return {items,getItem:(k:string)=>items.get(k)??null,removeItem:(k:string)=>{items.delete(k);}};}
it('forgets only the confirmed deleted owner auth record',()=>{const s=storage('A');expect(forgetDeletedSession(s,'auth','A')).toBe(true);expect(s.items.has('auth')).toBe(false);expect(s.items.get('finance-preferences')).toBe('retained');});
it('retains another owner session',()=>{const s=storage('B'),before=new Map(s.items);expect(forgetDeletedSession(s,'auth','A')).toBe(false);expect(s.items).toEqual(before);});
it('does not erase unknown storage or throw if persistence is unavailable',()=>{expect(forgetDeletedSession({getItem:()=>'{',removeItem:()=>{throw new Error('must not remove');}},'auth','A')).toBe(false);expect(forgetDeletedSession({getItem:()=>{throw new Error('blocked');},removeItem:()=>{}},'auth','A')).toBe(false);});
