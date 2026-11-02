// Called only by explicit, backed-up business reset operations and isolated rehearsals.
export async function retireLinks(db, schema, retired) {
  const quote=name=>{if(!/^[a-zA-Z0-9_]+$/.test(name))throw Error('Unsafe schema identifier');return '`'+name+'`';};
  const [links]=await db.query('SELECT TABLE_NAME,CONSTRAINT_NAME,REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_SCHEMA=?',[schema,schema]);
  const removed=[];
  for(const link of links)if(retired.includes(link.REFERENCED_TABLE_NAME)&&!retired.includes(link.TABLE_NAME)) {
    await db.query(`ALTER TABLE ${quote(link.TABLE_NAME)} DROP FOREIGN KEY ${quote(link.CONSTRAINT_NAME)}`);
    removed.push(link.TABLE_NAME+'.'+link.CONSTRAINT_NAME);
  }
  for(const [table,column] of [['nw_sop_material','file_id'],['nw_workbench','source_template_id'],['nw_memory_run_context','send_to_core']]) {
    const [columns]=await db.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',[schema,table,column]);
    if(columns.length){if((await db.query(`SELECT COUNT(*) n FROM ${quote(table)}`))[0][0].n!==0)throw Error('Retired columns require an empty, explicitly reset business table: '+table);await db.query(`ALTER TABLE ${quote(table)} DROP COLUMN ${quote(column)}`);removed.push(table+'.'+column);}
  }
  return removed;
}
