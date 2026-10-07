import type { FinanceState } from './types';
import { restoreFinanceState } from './finance';
export interface UndoEntry {before:FinanceState;after:FinanceState;owner:string}
export function captureUndo(before:FinanceState,after:FinanceState,owner:string):UndoEntry {
 if(!owner)throw new Error('Не визначено власника дії.');return {before:restoreFinanceState(before),after:restoreFinanceState(after),owner};
}
export function undoState(current:FinanceState,entry:UndoEntry,owner:string):FinanceState {
 if(owner!==entry.owner||!owner)throw new Error('Можна скасувати лише власну дію.');
 if(JSON.stringify(restoreFinanceState(current))!==JSON.stringify(entry.after))throw new Error('Дані вже змінилися. Попередню дію не скасовано.');
 return restoreFinanceState(entry.before);
}
