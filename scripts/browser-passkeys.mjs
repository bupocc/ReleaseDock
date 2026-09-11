// 仅供隔离浏览器验收使用；Chrome 仍通过原生 WebAuthn API 生成和验证凭据。
export async function addVirtualAuthenticator(context, page, credential = null) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
    isUserVerified: true, automaticPresenceSimulation: true,
  } });
  if (credential) await cdp.send('WebAuthn.addCredential', {
    authenticatorId, credential: {
      credentialId: Buffer.from(credential.id, 'base64url').toString('base64'),
      privateKey: credential.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
      userHandle: Buffer.from(credential.userHandle, 'base64url').toString('base64'),
      rpId: 'localhost', isResidentCredential: true, signCount: 0,
    },
  });
  return { cdp, authenticatorId };
}
