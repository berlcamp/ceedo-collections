-- The one sync_state row every sync reads (readSyncState: "row 1 is missing"). No migration
-- ever created it: only the engine-probe dev screen did, so every tablet that had run the
-- probe worked and the first fresh production install could not complete its first sync.
INSERT OR IGNORE INTO `sync_state` (`id`, `cursor`, `epoch`) VALUES (1, 0, 0);
