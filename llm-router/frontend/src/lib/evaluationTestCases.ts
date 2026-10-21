export interface TestCasePrompt {
  id: string;
  category: 'simple' | 'code' | 'complex';
  expected_tier: 'light' | 'code' | 'heavy';
  prompt: string;
}

export const EVALUATION_TEST_CASES: TestCasePrompt[] = [
  { id: 'eval-001', category: 'simple', expected_tier: 'light', prompt: 'Hi there, how are you?' },
  { id: 'eval-002', category: 'simple', expected_tier: 'light', prompt: 'What is DNS?' },
  { id: 'eval-003', category: 'simple', expected_tier: 'light', prompt: 'Define gravity in one sentence.' },
  { id: 'eval-004', category: 'simple', expected_tier: 'light', prompt: 'What is the capital of Japan?' },
  { id: 'eval-005', category: 'simple', expected_tier: 'light', prompt: 'Translate "good morning" to French.' },
  { id: 'eval-006', category: 'simple', expected_tier: 'light', prompt: 'What does HTTP stand for?' },
  { id: 'eval-007', category: 'simple', expected_tier: 'light', prompt: 'How many continents are there?' },
  { id: 'eval-008', category: 'simple', expected_tier: 'light', prompt: 'Give me one synonym for fast.' },
  { id: 'eval-009', category: 'simple', expected_tier: 'light', prompt: 'What is the freezing point of water in Celsius?' },
  { id: 'eval-010', category: 'simple', expected_tier: 'light', prompt: 'Who wrote Hamlet?' },

  { id: 'eval-011', category: 'code', expected_tier: 'code', prompt: 'Write a Python function to check if a string is a palindrome.' },
  { id: 'eval-012', category: 'code', expected_tier: 'code', prompt: 'Implement binary search in TypeScript.' },
  { id: 'eval-013', category: 'code', expected_tier: 'code', prompt: 'Fix this SQL query: SELECT name, count(*) FROM users GROUP name' },
  { id: 'eval-014', category: 'code', expected_tier: 'code', prompt: 'Write a bash script to find and delete all .log files older than 7 days.' },
  { id: 'eval-015', category: 'code', expected_tier: 'code', prompt: 'How do you invert a binary tree in Rust? Provide code.' },
  { id: 'eval-016', category: 'code', expected_tier: 'code', prompt: 'Write a regular expression to validate an IPv4 address.' },
  { id: 'eval-017', category: 'code', expected_tier: 'code', prompt: 'Create a React custom hook for debouncing a value.' },
  { id: 'eval-018', category: 'code', expected_tier: 'code', prompt: 'Write an asynchronous retry function with exponential backoff in JavaScript.' },
  { id: 'eval-019', category: 'code', expected_tier: 'code', prompt: 'Explain the difference between interface and type in TypeScript with code examples.' },
  { id: 'eval-020', category: 'code', expected_tier: 'code', prompt: 'Write a Python decorator that measures and prints function execution time.' },

  { id: 'eval-021', category: 'complex', expected_tier: 'heavy', prompt: 'Design a distributed rate limiter supporting 100k requests/second across multiple regions. Compare Token Bucket and Sliding Window algorithms, discuss Redis vs Envoy local filters, and address clock drift.' },
  { id: 'eval-022', category: 'complex', expected_tier: 'heavy', prompt: 'Analyze the architectural trade-offs between Event Sourcing and CRUD with CDC (Change Data Capture) for an audit-heavy financial accounting platform.' },
  { id: 'eval-023', category: 'complex', expected_tier: 'heavy', prompt: 'Derive Bayes theorem step by step and explain its application in filtering spam with conditional probabilities.' },
  { id: 'eval-024', category: 'complex', expected_tier: 'heavy', prompt: 'Compare Paxos and Raft consensus algorithms in detail, focusing on leader election, log replication, and split-brain scenarios.' },
  { id: 'eval-025', category: 'complex', expected_tier: 'heavy', prompt: 'A train leaves Station A heading to B at 60 km/h. Another train leaves B towards A at 90 km/h. The distance is 300 km. A bird flies back and forth between trains at 120 km/h until they meet. How far does the bird fly? Walk through the logic.' },
  { id: 'eval-026', category: 'complex', expected_tier: 'heavy', prompt: 'Critique the CAP theorem in light of modern distributed cloud databases like Google Spanner and CockroachDB.' },
  { id: 'eval-027', category: 'complex', expected_tier: 'heavy', prompt: 'Provide an in-depth breakdown of zero-knowledge proofs (zk-SNARKs vs zk-STARKs) and their trade-offs in cryptographic privacy.' },
  { id: 'eval-028', category: 'complex', expected_tier: 'heavy', prompt: 'Design a high-throughput, fault-tolerant message queue from scratch. Detail storage layout, partition replication, consumer group offset management, and crash recovery.' },
  { id: 'eval-029', category: 'complex', expected_tier: 'heavy', prompt: 'Analyze the economic and technical trade-offs between monolithic databases and microservice distributed data meshes.' },
  { id: 'eval-030', category: 'complex', expected_tier: 'heavy', prompt: 'How does modern TLS 1.3 handshake achieve zero-RTT and forward secrecy? Explain key exchange and cryptography mathematically.' },
];
