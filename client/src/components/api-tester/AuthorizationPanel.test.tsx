import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthorizationPanel, emptyAuthParamsFor } from './AuthorizationPanel';
import type { AuthParams, AuthType } from '@shared/schema';

/**
 * The Authorization tab.
 *
 * Three things were wrong with it. The dropdown offered fourteen schemes of which eight do
 * nothing, and said only "parameters are not yet configurable" — which reads as though the
 * request would still be authenticated somehow, when in fact it went out with no
 * credentials at all. The scheme and its parameters were two pieces of state and only the
 * first was updated on a change, so the page could show one scheme while sending another.
 * And OAuth 2.0, the one enterprise APIs actually use, had no form because it cannot work
 * from a browser: the token endpoint is a different origin and the client secret would be
 * in everyone's network tab.
 */

const openSelect = async (trigger: HTMLElement) => {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
  await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
};

const renderPanel = (authType: AuthType, authParams?: AuthParams) => {
  const onAuthTypeChange = vi.fn();
  const onAuthParamsChange = vi.fn();
  render(
    <AuthorizationPanel
      authType={authType}
      authParams={authParams}
      onAuthTypeChange={onAuthTypeChange}
      onAuthParamsChange={onAuthParamsChange}
    />,
  );
  return { onAuthTypeChange, onAuthParamsChange };
};

const oauth2Params = (over: Record<string, unknown> = {}): AuthParams =>
  ({
    type: 'oauth2',
    params: {
      grantType: 'client_credentials',
      tokenUrl: '',
      clientId: '',
      clientSecret: '',
      scope: '',
      username: '',
      password: '',
      clientAuth: 'header',
      ...over,
    },
  }) as AuthParams;

describe('the OAuth 2.0 form', () => {
  it('is shown when that is the scheme', () => {
    renderPanel('oauth2', oauth2Params());

    expect(screen.getByLabelText('Token URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Client ID')).toBeInTheDocument();
  });

  it('reports the whole settings object, not just the field that changed', () => {
    const { onAuthParamsChange } = renderPanel('oauth2', oauth2Params({ clientId: 'svc' }));

    fireEvent.change(screen.getByLabelText('Token URL'), {
      target: { value: 'https://login.example.com/token' },
    });

    // A partial update would drop the client id the tester already entered.
    expect(onAuthParamsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'oauth2',
        params: expect.objectContaining({
          tokenUrl: 'https://login.example.com/token',
          clientId: 'svc',
        }),
      }),
    );
  });

  it('asks for a username only when the grant needs one', () => {
    const { unmount } = render(
      <AuthorizationPanel
        authType="oauth2"
        authParams={oauth2Params()}
        onAuthTypeChange={vi.fn()}
        onAuthParamsChange={vi.fn()}
      />,
    );
    // client_credentials authenticates the service itself; there is no user in it.
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
    unmount();

    renderPanel('oauth2', oauth2Params({ grantType: 'password' }));
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
  });

  it('says why the authorization-code grant is not on offer', () => {
    renderPanel('oauth2', oauth2Params());

    // The grant everyone reaches for first, and the one a schedule at 3am cannot complete.
    expect(screen.getByText(/needs a person at a browser/i)).toBeInTheDocument();
  });
});

describe('changing the scheme', () => {
  it('clears the parameters of the one before it', async () => {
    const { onAuthTypeChange, onAuthParamsChange } = renderPanel('bearer', {
      type: 'bearer',
      params: { token: 'a-token-the-tester-pasted' },
    } as AuthParams);

    await openSelect(screen.getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: /Basic Auth/i }));

    expect(onAuthTypeChange).toHaveBeenCalledWith('basic');
    // Without this the page showed Basic Auth and sent the bearer token, because it is the
    // parameters that are sent and nothing reset them.
    expect(onAuthParamsChange).toHaveBeenCalledWith({
      type: 'basic',
      params: { username: '', password: '' },
    });
  });

  it('has an empty starting point for every scheme', () => {
    // Exhaustive so a scheme added to the enum cannot quietly fall through to a shape the
    // form beside it does not understand.
    expect(emptyAuthParamsFor('bearer')).toEqual({ type: 'bearer', params: { token: '' } });
    expect(emptyAuthParamsFor('apiKey')).toEqual({
      type: 'apiKey',
      params: { key: '', value: '', addTo: 'header' },
    });
    expect(emptyAuthParamsFor('ntlm')).toEqual({
      type: 'ntlm',
      params: { username: '', password: '', domain: '', workstation: '' },
    });
    expect(emptyAuthParamsFor('akamai')).toMatchObject({ type: 'akamai', params: { maxBody: 131072 } });
    expect(emptyAuthParamsFor('none')).toEqual({ type: 'none' });
    expect(emptyAuthParamsFor('oauth2')).toMatchObject({
      type: 'oauth2',
      params: { grantType: 'client_credentials', clientAuth: 'header' },
    });
  });
});

describe('the schemes that used to be names only', () => {
  it('can all be picked', async () => {
    renderPanel('none', { type: 'none' } as AuthParams);

    await openSelect(screen.getByRole('combobox'));

    for (const name of [/JWT Bearer/, /Digest/, /OAuth 1\.0/, /Hawk/, /AWS Signature/, /NTLM/, /Akamai/, /ASAP/]) {
      const option = await screen.findByRole('option', { name });
      expect(option).not.toHaveAttribute('aria-disabled', 'true');
      expect(option).not.toHaveTextContent('(not available)');
    }
  });

  it('opens a test saved when NTLM was only a name, with its fields empty', () => {
    const { onAuthParamsChange } = renderPanel('ntlm', { type: 'ntlm' } as AuthParams);

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'CORP\\alice' } });

    expect(onAuthParamsChange).toHaveBeenCalledWith({
      type: 'ntlm',
      params: { username: 'CORP\\alice', password: '', domain: '', workstation: '' },
    });
  });

  it('keeps what was entered when another field changes', () => {
    const { onAuthParamsChange } = renderPanel('aws', {
      type: 'aws',
      params: { accessKey: 'AKID', secretKey: 's', sessionToken: '', region: 'eu-west-1', service: '' },
    } as AuthParams);

    fireEvent.change(screen.getByLabelText('Service'), { target: { value: 'execute-api' } });

    expect(onAuthParamsChange).toHaveBeenCalledWith({
      type: 'aws',
      params: { accessKey: 'AKID', secretKey: 's', sessionToken: '', region: 'eu-west-1', service: 'execute-api' },
    });
    expect(screen.getByLabelText('Secret key')).toHaveAttribute('type', 'password');
  });

  it('asks JWT for a shared secret or a PEM key, as the algorithm needs', () => {
    const { unmount } = render(
      <AuthorizationPanel
        authType="jwtBearer"
        authParams={{ type: 'jwtBearer', params: { algorithm: 'HS256' } } as AuthParams}
        onAuthTypeChange={vi.fn()}
        onAuthParamsChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Secret or private key')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Secret is Base64 encoded')).toBeInTheDocument();
    unmount();

    renderPanel('jwtBearer', { type: 'jwtBearer', params: { algorithm: 'RS256' } } as AuthParams);
    expect(screen.getByLabelText('Secret or private key').tagName).toBe('TEXTAREA');
    expect(screen.queryByLabelText('Secret is Base64 encoded')).not.toBeInTheDocument();
  });

  it('has a label for every field of every scheme', () => {
    for (const type of ['jwtBearer', 'digest', 'oauth1', 'hawk', 'aws', 'ntlm', 'akamai', 'asap'] as const) {
      const { unmount, container } = render(
        <AuthorizationPanel authType={type} authParams={emptyAuthParamsFor(type)} onAuthTypeChange={vi.fn()} onAuthParamsChange={vi.fn()} />,
      );
      // An untranslated key shows as its path.
      expect(container.textContent).not.toMatch(/authForms\./);
      unmount();
    }
  });
});
