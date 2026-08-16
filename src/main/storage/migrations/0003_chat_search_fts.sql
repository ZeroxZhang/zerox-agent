-- P96 AE-11: bounded Chat search candidates backed by FTS5 trigram indexes.

CREATE INDEX IF NOT EXISTS idx_chat_messages_created
  ON chat_messages(created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS chat_message_fts USING fts5(
  content,
  content='chat_messages',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS chat_message_fts_ai
AFTER INSERT ON chat_messages BEGIN
  INSERT INTO chat_message_fts(rowid, content)
  VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS chat_message_fts_ad
AFTER DELETE ON chat_messages BEGIN
  INSERT INTO chat_message_fts(chat_message_fts, rowid, content)
  VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS chat_message_fts_au
AFTER UPDATE OF content ON chat_messages BEGIN
  INSERT INTO chat_message_fts(chat_message_fts, rowid, content)
  VALUES ('delete', old.rowid, old.content);
  INSERT INTO chat_message_fts(rowid, content)
  VALUES (new.rowid, new.content);
END;

INSERT INTO chat_message_fts(chat_message_fts) VALUES ('rebuild');

CREATE VIRTUAL TABLE IF NOT EXISTS chat_session_title_fts USING fts5(
  title,
  content='chat_session_projections',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS chat_session_title_fts_ai
AFTER INSERT ON chat_session_projections BEGIN
  INSERT INTO chat_session_title_fts(rowid, title)
  VALUES (new.rowid, new.title);
END;

CREATE TRIGGER IF NOT EXISTS chat_session_title_fts_ad
AFTER DELETE ON chat_session_projections BEGIN
  INSERT INTO chat_session_title_fts(chat_session_title_fts, rowid, title)
  VALUES ('delete', old.rowid, old.title);
END;

CREATE TRIGGER IF NOT EXISTS chat_session_title_fts_au
AFTER UPDATE OF title ON chat_session_projections BEGIN
  INSERT INTO chat_session_title_fts(chat_session_title_fts, rowid, title)
  VALUES ('delete', old.rowid, old.title);
  INSERT INTO chat_session_title_fts(rowid, title)
  VALUES (new.rowid, new.title);
END;

INSERT INTO chat_session_title_fts(chat_session_title_fts) VALUES ('rebuild');
