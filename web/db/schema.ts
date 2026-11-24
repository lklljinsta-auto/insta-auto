import {sqliteTable,text,integer,uniqueIndex} from 'drizzle-orm/sqlite-core';
export const accounts=sqliteTable('accounts',{
 id:text().primaryKey(),owner:text().notNull(),handle:text().notNull(),alias:text().notNull(),guide:text().notNull(),updated:text().notNull()
},t=>[uniqueIndex('owner_handle').on(t.owner,t.handle)]);
export const drafts=sqliteTable('drafts',{
 id:text().primaryKey(),owner:text().notNull(),account:text().notNull().references(()=>accounts.id),
 title:text().notNull(),caption:text().notNull(),format:text().notNull(),source:text().notNull(),schedule:text(),updated:text().notNull()
});
export const files=sqliteTable('files',{
 id:text().primaryKey(),owner:text().notNull(),draft:text().notNull().references(()=>drafts.id),name:text().notNull(),size:integer().notNull(),updated:text().notNull(),objectKey:text().notNull()
});
export const viewers=sqliteTable('viewers',{
 email:text().primaryKey(),owner:text().notNull(),added:text().notNull()
});
