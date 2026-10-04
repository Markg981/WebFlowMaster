import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ProtocolConfig } from '@shared/api-protocol-config';
import { ProtocolConfigEditor } from './ProtocolConfigEditor';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }) }));
function Harness({ initial = null }: { initial?: ProtocolConfig | null }) {
  const [value, setValue] = useState<ProtocolConfig | null>(initial);
  return <><ProtocolConfigEditor method="GRPC" value={value} onChange={setValue} /><output data-testid="config">{JSON.stringify(value)}</output></>;
}
describe('ProtocolConfigEditor', () => {
  it('loads references and edits limits/mode without resolving secrets', () => {
    render(<Harness initial={{ grpcMode: 'server_stream', tls: { rootCa: '{{secret_ca}}' } }} />);
    expect(screen.getByLabelText('Root CA secret reference')).toHaveValue('{{secret_ca}}');
    fireEvent.change(screen.getByLabelText('gRPC mode'), { target: { value: 'bidi' } });
    fireEvent.change(screen.getByLabelText('Overall timeout (ms)'), { target: { value: '45000' } });
    expect(JSON.parse(screen.getByTestId('config').textContent!)).toMatchObject({ grpcMode: 'bidi', timeoutMs: 45000, tls: { rootCa: '{{secret_ca}}' } });
  });
  it('shows invalid bounds and plaintext TLS values without exposing an insecure toggle', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Client key secret reference'), { target: { value: '-----BEGIN PRIVATE KEY-----' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Overall timeout (ms)'), { target: { value: '60001' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByLabelText(/insecure|skip verification/i)).toBeNull();
  });
});
