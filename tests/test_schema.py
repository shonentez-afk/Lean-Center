import sqlite3
import unittest
from pathlib import Path

class SchemaTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript((Path(__file__).resolve().parents[1]/'db/schema_v1.sql').read_text(encoding='utf-8'))
        self.db.executescript("""
        INSERT INTO person(id,employee_code,display_name) VALUES ('p','P','Demo mentor'),('a','A','Demo auditor');
        INSERT INTO checklist VALUES ('c','L1','TWI');
        INSERT INTO checklist_version VALUES ('v1','c',1,'draft','{}'),('v2','c',2,'draft','{}');
        INSERT INTO checklist_criterion VALUES ('k1','v1','K','step1',1,'Question',1),('k2','v2','K','step1',1,'Question',0);
        INSERT INTO audit_session(id,version_id,mentor_id,auditor_id,observed_at,state,recorded_names_json) VALUES ('a1','v1','p','a','2026-11-25T00:00:00Z','draft','{}');
        """)
    def tearDown(self):
        self.db.close()
    def test_schema_integrity(self):
        self.assertEqual(self.db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
        self.assertEqual(self.db.execute('PRAGMA user_version').fetchone()[0],1)
    def test_mixed_version_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO audit_response(id,audit_id,version_id,criterion_id,response) VALUES ('r','a1','v1','k2','yes')")
    def test_unknown_not_failure(self):
        self.db.execute("INSERT INTO audit_response(id,audit_id,version_id,criterion_id,response,note) VALUES ('r','a1','v1','k1','not_observed','Not seen')")
        self.db.execute("UPDATE audit_session SET state='final' WHERE id='a1'")
        self.assertEqual(self.db.execute('SELECT observed,score_pct,critical_failures FROM v_audit_scores').fetchone(),(0,None,0))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE audit_response SET response='yes' WHERE id='r'")
    def test_duplicate_and_critical(self):
        self.db.execute("INSERT INTO audit_response(id,audit_id,version_id,criterion_id,response) VALUES ('r','a1','v1','k1','no')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO audit_response(id,audit_id,version_id,criterion_id,response) VALUES ('r2','a1','v1','k1','yes')")
        self.db.execute("UPDATE audit_session SET state='final' WHERE id='a1'")
        self.assertEqual(self.db.execute('SELECT score_pct,critical_failures FROM v_audit_scores').fetchone(),(0.0,1))
    def test_document_version(self):
        self.db.execute("INSERT INTO document(id,code,kind,title) VALUES ('d','D','sop','Demo')")
        self.db.execute("INSERT INTO document_revision(id,document_id,version_no,state,payload_json,created_at,effective_at) VALUES ('v','d',1,'effective','{}','2026-11-25','2026-11-25')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO document_revision(id,document_id,version_no,state,payload_json,created_at,effective_at) VALUES ('w','d',2,'effective','{}','2026-11-25','2026-11-25')")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE document_revision SET payload_json='{\"changed\":true}' WHERE id='v'")

if __name__ == '__main__':
    unittest.main()
