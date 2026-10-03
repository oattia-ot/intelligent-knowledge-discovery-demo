export const environment = {
  production: false,
  appTitle: 'Knowledge Discovery Sandbox Demo',
  appName: 'KD Internal Knowledge Search',
  /**
   * Milestone 2+: Community UserRead via Angular dev proxy → webui.idoldemos.net.
   * Set true only for offline UI work without Community.
   */
  useStubAuth: false,
  gatewayOrigin: '',
  communityApiUrl: '/community',
  contentApiUrl: '/content',
  contentIndexApiUrl: '/content/Index',
  qmsApiUrl: '/qms',
  viewApiUrl: '/view',
  /** Same-origin proxy path for View ACI actions. */
  viewServerUrl: '/view',
  /**
   * Real View host used to rewrite nested /action=getlink iframe URLs inside
   * View HTML (xECM multi-page). Root-relative /action= hits the SPA otherwise.
   */
  viewUpstreamOrigin: 'https://172.25.125.123:9080',
  nifiCanvasUrl: 'https://172.25.125.123:27111/nifi',
  agentstoreApiUrl: '/agentstore',
  categoryApiUrl: '/category',
  answerServerApiUrl: '/answerserver',
  sessionKey: 'kd_auth_user',
  summaryContextLength: 200,
  idleTimeoutMinutes: 30,
  /** Community role required for `/admin` and JSON config writes. */
  adminRole: 'KDUIAdmin',
  /** Thin Node writer (proxied by ng serve). */
  adminApiUrl: '/api/admin',
  /** Query-string cache buster for assets/config and .hbs. */
  configVersion: 'dev'
};
