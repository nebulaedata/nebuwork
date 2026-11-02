ALTER TABLE tasks DROP CONSTRAINT tasks_knowledge_base_id_fkey;
ALTER TABLE tasks ADD CONSTRAINT tasks_knowledge_base_id_fkey FOREIGN KEY(knowledge_base_id) REFERENCES knowledge_bases(id) ON DELETE SET NULL;
ALTER TABLE tasks DROP CONSTRAINT tasks_knowledge_id_fkey;
ALTER TABLE tasks ADD CONSTRAINT tasks_knowledge_id_fkey FOREIGN KEY(knowledge_id) REFERENCES knowledge(id) ON DELETE SET NULL;
