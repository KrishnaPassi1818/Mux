import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Pill } from '../components/ui/Pill';
import { ShieldCheck, CheckCircle2 } from 'lucide-react';

export const PrivacyPage = () => {
  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow"><ShieldCheck size={12} /> Compliance & Architecture</p>
          <h1 className="page-title">Privacy Policy</h1>
          <p className="page-description">Strict local data sovereignty policy for LLM Router deployments and client interfaces.</p>
        </div>
        <Pill tone="success"><CheckCircle2 size={11} /> Zero Remote Telemetry</Pill>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '880px' }}>
        <Card>
          <CardHeader>
            <div>
              <h2 className="card-title">1. Local Execution & Data Sovereignty</h2>
              <p className="card-subtitle">Zero data transmission beyond your host machine</p>
            </div>
          </CardHeader>
          <CardBody>
            <p className="side-copy" style={{ fontSize: '13px', margin: 0 }}>
              LLM Router operates entirely within your designated host environment or private network infrastructure.
              All conversational prompts, responses, embeddings, model states, and routing decisions are processed locally
              via your local Ollama runtime and backend gateway services. No user data, input prompts, or model outputs
              are transmitted to external servers, third-party cloud AI vendors, or remote telemetry collectors.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <h2 className="card-title">2. No Analytics, Tracking, or Advertising</h2>
              <p className="card-subtitle">Uncompromised developer privacy</p>
            </div>
          </CardHeader>
          <CardBody>
            <p className="side-copy" style={{ fontSize: '13px', margin: 0 }}>
              The application does not include third-party tracking cookies, analytics pixels, advertising scripts, or session
              replays. Performance metrics displayed on the dashboard are computed from internal system ring buffers and are
              stored exclusively in browser volatile memory or local Redis instances configured by the operator.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <h2 className="card-title">3. Storage & Cache Lifecycle</h2>
              <p className="card-subtitle">Local storage and response cache management</p>
            </div>
          </CardHeader>
          <CardBody>
            <p className="side-copy" style={{ fontSize: '13px', margin: 0 }}>
              Client preferences (such as theme and routing preview options) are persisted locally via standard browser
              <code>localStorage</code>. Cached completions reside strictly in your operator-configured Redis cache.
              Cache keys are normalized hashes of input prompt structures; partial streams, error events, and high-temperature
              sampling requests are never written to the cache. Operators retain full authority to flush caches at any time via the Settings interface.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <h2 className="card-title">4. Operational Logs & Retention</h2>
              <p className="card-subtitle">Logging hygiene and auditability</p>
            </div>
          </CardHeader>
          <CardBody>
            <p className="side-copy" style={{ fontSize: '13px', margin: 0 }}>
              Log streams emitted by the gateway and router components conform to structured JSON logging specifications
              without recording raw user prompt text or personal identifiers. Operators are solely responsible for managing
              underlying host system log retention schedules and security controls.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
};
