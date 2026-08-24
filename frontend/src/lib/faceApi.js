let faceapiPromise = null;

export const loadFaceApi = () => {
  if (!faceapiPromise) {
    faceapiPromise = import("face-api.js").then((m) => m.default ?? m);
  }
  return faceapiPromise;
};

export default loadFaceApi;
