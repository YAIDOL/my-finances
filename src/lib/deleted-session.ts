/** Do not call SDK signOut here: its async cleanup can erase a newer user's session. */
export function forgetDeletedSession(storage:Pick<Storage,'getItem'|'removeItem'>,key:string,owner:string):boolean{
 try{const raw=storage.getItem(key);if(!raw||JSON.parse(raw)?.user?.id!==owner)return false;storage.removeItem(key);return true;}catch{return false;}
}
