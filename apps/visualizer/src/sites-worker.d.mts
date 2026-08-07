interface SitesAssetsBinding {
  fetch(request: Request): Promise<Response>;
}

interface SitesWorkerEnvironment {
  ASSETS: SitesAssetsBinding;
}

declare const worker: {
  fetch(request: Request, environment: SitesWorkerEnvironment): Promise<Response>;
};

export default worker;
