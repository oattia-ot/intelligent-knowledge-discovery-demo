export const environment = {
  production: true,
  appTitle: 'Knowledge Discovery Sandbox Demo',
  appName: 'KD Internal Knowledge Search',
  useStubAuth: false,
  gatewayOrigin: '',
  communityApiUrl: '/Community',
  contentApiUrl: '/Content',
  contentIndexApiUrl: '/Content/Index',
  qmsApiUrl: '/QMS',
  viewApiUrl: '/View',
  viewServerUrl: '/View',
  /** When SPA and View share a gateway, use same origin or the View public origin. */
  viewUpstreamOrigin: 'https://view.idoldemos.net:9080',
  nifiCanvasUrl: 'https://172.25.125.123:27111/nifi',
  agentstoreApiUrl: '/Agentstore',
  categoryApiUrl: '/Category',
  answerServerApiUrl: '/AnswerServer',
  sessionKey: 'kd_auth_user',
  summaryContextLength: 200,
  idleTimeoutMinutes: 30,
  /** Community role required for `/admin` and JSON config writes. */
  adminRole: 'KDUIAdmin',
  /** Thin Node writer (Nginx / ng-serve proxy) for config/*.json. */
  adminApiUrl: '/api/admin',
  /** Query-string cache buster for assets/config and .hbs. */
  configVersion: 'sandbox'
};
