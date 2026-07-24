import assert from 'node:assert/strict';
import {
  buildDingTalkParameterRows,
  buildLangfuseParameterGroups,
  buildTapdParameterRows,
  parseLangfuseParameterText,
} from '../src/modules/config/parameterDisplay.js';

{
  const rows = buildTapdParameterRows({
    apiUser: 'tapd-app-a2b2d6',
    apiPassword: '4FD14849-6853-3063-7852-F9DAAA345843',
    workspaceId: '61252348',
    companyId: '52890462',
  });

  assert.deepEqual(rows, [
    { label: '应用ID', value: 'tapd-app-a2b2d6' },
    { label: '应用密钥', value: '4FD14849-6853-3063-7852-F9DAAA345843' },
    { label: '项目ID', value: '61252348' },
    { label: '公司ID', value: '52890462' },
  ]);
}

{
  const rows = buildDingTalkParameterRows({
    webhook: 'https://oapi.dingtalk.com/robot/send?access_token=token-value',
    secret: 'SEC81be1263bd311f9641894eca6a97552e51e198214e10a22fe491a8b49e41b9ca',
    accessToken: 'should-not-render',
    groupName: 'should-not-render',
  });

  assert.deepEqual(rows, [
    { label: 'Webhook', field: 'webhook', value: 'https://oapi.dingtalk.com/robot/send?access_token=token-value' },
    { label: '加签', field: 'secret', value: 'SEC81be1263bd311f9641894eca6a97552e51e198214e10a22fe491a8b49e41b9ca' },
  ]);
}

{
  const parsed = parseLangfuseParameterText([
    'LANGFUSE_SECRET_KEY="sk-lf-updated"',
    'LANGFUSE_PUBLIC_KEY="pk-lf-updated"',
    'LANGFUSE_BASE_URL="https://monitor.example.com"',
  ].join('\n'));

  assert.deepEqual(parsed, {
    secretKey: 'sk-lf-updated',
    publicKey: 'pk-lf-updated',
    baseUrl: 'https://monitor.example.com',
  });
}

{
  const groups = buildLangfuseParameterGroups([
    {
      label: 'Test-Local',
      secretKey: 'sk-lf-test-local',
      publicKey: 'pk-lf-test-local',
      baseUrl: 'https://monitor-live-test-cedar.sdmc.tv',
    },
  ]);

  assert.deepEqual(groups, [
    {
      label: 'Test-Local',
      text: [
        'LANGFUSE_SECRET_KEY="sk-lf-test-local"',
        'LANGFUSE_PUBLIC_KEY="pk-lf-test-local"',
        'LANGFUSE_BASE_URL="https://monitor-live-test-cedar.sdmc.tv"',
      ].join('\n'),
      lines: [
        'LANGFUSE_SECRET_KEY="sk-lf-test-local"',
        'LANGFUSE_PUBLIC_KEY="pk-lf-test-local"',
        'LANGFUSE_BASE_URL="https://monitor-live-test-cedar.sdmc.tv"',
      ],
    },
  ]);
}

{
  const groups = buildLangfuseParameterGroups({
    label: 'UAT',
    secretKey: '',
    publicKey: 'pk-lf-uat',
    baseUrl: '',
  });

  assert.deepEqual(groups, [
    {
      label: 'UAT',
      text: [
        'LANGFUSE_SECRET_KEY=""',
        'LANGFUSE_PUBLIC_KEY="pk-lf-uat"',
        'LANGFUSE_BASE_URL=""',
      ].join('\n'),
      lines: [
        'LANGFUSE_SECRET_KEY=""',
        'LANGFUSE_PUBLIC_KEY="pk-lf-uat"',
        'LANGFUSE_BASE_URL=""',
      ],
    },
  ]);
}
