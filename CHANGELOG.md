## [1.1.2](https://github.com/Overcastly-AI/hunt-maps/compare/v1.1.1...v1.1.2) (2026-08-07)

### Fixes

* **ci:** lowercase the owner for cosign and helm push ([1eaab7f](https://github.com/Overcastly-AI/hunt-maps/commit/1eaab7fe87bf1efdd0fda3749200793e420b76cc))
* **ci:** namespace the published chart under the repository, not a bare charts/ ([08736c7](https://github.com/Overcastly-AI/hunt-maps/commit/08736c75e8793c08d481cc47b724859a648a85cb))
* lowercase OCI refs and namespace the chart under the repo ([#10](https://github.com/Overcastly-AI/hunt-maps/issues/10)) ([a189452](https://github.com/Overcastly-AI/hunt-maps/commit/a1894520ddb79d564a1040d80ea4ed82f4455090))

## [1.1.1](https://github.com/Overcastly-AI/hunt-maps/compare/v1.1.0...v1.1.1) (2026-08-07)

### Fixes

* **ci:** release job failed after publishing, skipping images and chart ([a798c83](https://github.com/Overcastly-AI/hunt-maps/commit/a798c83b3e0d589601bba8d11baaea97fe716fbf))
* release pipeline stranded v1.1.0 without images or chart ([#9](https://github.com/Overcastly-AI/hunt-maps/issues/9)) ([3c92583](https://github.com/Overcastly-AI/hunt-maps/commit/3c92583283358f223b21c83cba9b35948199513b))

### Documentation

* make the Helm install one command, defaulting to ridgeline.localtest.me ([6adacc5](https://github.com/Overcastly-AI/hunt-maps/commit/6adacc5bf02257db6e015cf80331f0710efa952c))

## [1.1.0](https://github.com/Overcastly-AI/hunt-maps/compare/v1.0.0...v1.1.0) (2026-08-07)

### Features

* **deploy:** production hardening across images, chart and release pipeline ([024fee1](https://github.com/Overcastly-AI/hunt-maps/commit/024fee1551095710c885aeb8f6d114e101449890))
* **helm:** derive CORS origins from the ingress host ([6a8c5c0](https://github.com/Overcastly-AI/hunt-maps/commit/6a8c5c0d4202d0b893222acf2c7f54520bda8831))
* production hardening, semantic releases, and container smoke tests ([#8](https://github.com/Overcastly-AI/hunt-maps/issues/8)) ([fcf8335](https://github.com/Overcastly-AI/hunt-maps/commit/fcf8335d945d8bf101664bc91bf292732c42063c))

### Fixes

* **api:** the image could never start — entrypoint was at a different path ([1fb3539](https://github.com/Overcastly-AI/hunt-maps/commit/1fb35393562e305d193c6f9d1044f3dae8767992))
* **helm:** reject a too-short jwtSecret at install instead of at pod start ([e7132b7](https://github.com/Overcastly-AI/hunt-maps/commit/e7132b7f052c89ceaf3b64233cce4f1560891aa8))

### Documentation

* **backlog:** file the agent-tooling rename as P2 ([d608d03](https://github.com/Overcastly-AI/hunt-maps/commit/d608d037d40e69b3e1a13db91469dffc85f4566e))

## 1.0.0 (2026-08-07)

### Features

* **api:** NestJS + PostGIS backend with terrain, analytics and offline services ([c94832e](https://github.com/Overcastly-AI/hunt-maps/commit/c94832e4e950d039ca6af7fe2044f09cdc23db77))
* autonomous agent org, deployment, and project documentation ([a706052](https://github.com/Overcastly-AI/hunt-maps/commit/a7060526757f62ca7524da6c19f9c76c5b20ada7))
* decouple design system into @hunt-maps/design; add game-biologist agent ([54d36b3](https://github.com/Overcastly-AI/hunt-maps/commit/54d36b3418b76eeb063d50ef73fe72d4511b305a))
* **deploy:** Helm chart for running Ridgeline on a local cluster ([fe6e940](https://github.com/Overcastly-AI/hunt-maps/commit/fe6e9404d2bf5d14f80dbca99368631233708804))
* **deploy:** make the root compose the one you deploy — self-contained, builds from source ([8289c92](https://github.com/Overcastly-AI/hunt-maps/commit/8289c92523b6567fe9449218f3e6e37a1ee2564d))
* **deploy:** one-file compose importable directly from a URL ([13acdd7](https://github.com/Overcastly-AI/hunt-maps/commit/13acdd73510a1f6b3d11126521127d4867b13bb6))
* **deploy:** production compose for a single Docker host ([9f1b7e3](https://github.com/Overcastly-AI/hunt-maps/commit/9f1b7e3ee592e0344e5bbfbcdf0e354a3437aca8))
* **design:** map-first UI with its own visual identity ([020e4c8](https://github.com/Overcastly-AI/hunt-maps/commit/020e4c8d476a25ca47c1c71a247d6b45036d528b)), closes [#c9a253](https://github.com/Overcastly-AI/hunt-maps/issues/c9a253)
* **release:** semantic-release drives versions, images and the packaged chart ([06524ff](https://github.com/Overcastly-AI/hunt-maps/commit/06524ff3593c9e8688d88a628e4d3d4b13686c7c))
* **terrain:** DEM analytics engine with landform, solar, thermal and corridor analysis ([9a5009f](https://github.com/Overcastly-AI/hunt-maps/commit/9a5009f4356b52bbf70ecf40c77c948294d3cadb))
* **web:** offline-first MapLibre PWA with on-device terrain analysis ([65011cf](https://github.com/Overcastly-AI/hunt-maps/commit/65011cf924d36ed3775e0c365349b6cc697a2ddb))

### Fixes

* **agents:** give product-auditor web research tools; add first product audit ([a859863](https://github.com/Overcastly-AI/hunt-maps/commit/a8598639f3eb506983da86c66cb65cd30fec2525))
* **compose:** docker-compose.yml was unparseable — the error message ate itself ([cbfbf13](https://github.com/Overcastly-AI/hunt-maps/commit/cbfbf134c6e66f303d0d0cdd84999bfc458f3ac5))
* **design:** wind and time editors become anchored popovers, not drawers ([cb92f22](https://github.com/Overcastly-AI/hunt-maps/commit/cb92f22f597bdf1fa0a527dd08bd10e3c931bc85))
* **docker:** the web image has not built since the design system was extracted ([766c539](https://github.com/Overcastly-AI/hunt-maps/commit/766c539ac6d3aaed7d9d6188afd48c7dd5f9e5b6))
* **helm:** default to locally built images, because the published ones do not exist ([b19ed05](https://github.com/Overcastly-AI/hunt-maps/commit/b19ed058a2f4b4aaa5cfea519efe228b94e8bbde))
* **map:** theme MapLibre controls; make Wood classifier threshold scale-aware ([beea684](https://github.com/Overcastly-AI/hunt-maps/commit/beea6844c635a18a8b4e06b1a19767a1fd405b48))
* **ui:** raise chrome text to AA, meet the 44px gloved floor, and stop the sheet moving its own trigger ([1c469d9](https://github.com/Overcastly-AI/hunt-maps/commit/1c469d95a8bb8c7417f3b8a1044e2efea5176295))
* **web:** the wind popover was painted under the layers sheet and unclickable ([de81f75](https://github.com/Overcastly-AI/hunt-maps/commit/de81f75f83eaccbddc33712a830693ae8259cece))

### Refactoring

* **deploy:** consolidate the deployment story and take the secrets out of git ([b5ee3b7](https://github.com/Overcastly-AI/hunt-maps/commit/b5ee3b763b44c7ace321b17139e0ed48a828c589))
* **design:** remove the brand mark from the map chrome ([b28a62d](https://github.com/Overcastly-AI/hunt-maps/commit/b28a62d446713a3f3d420f894ff5d2588fc8957b))

### Documentation

* **agents:** the biologist has working web search — say so, and require negative results to show their work ([ea913ca](https://github.com/Overcastly-AI/hunt-maps/commit/ea913ca5d7b2d4eede841d989d03831f9bcf0546))
* **audit:** land the biology and product audits, and fix the research guidance that hobbled them ([3f97cb0](https://github.com/Overcastly-AI/hunt-maps/commit/3f97cb0a38989e711ea7c43616b722659d491ed6))
* **backlog:** file the second biology pass, withdraw R26 as my misdiagnosis, open the algorithms research ([c4acd93](https://github.com/Overcastly-AI/hunt-maps/commit/c4acd93e18675b5cfb654d199fa3a0775305d163))
* make UI a first-class failure class, and require the orchestrator to delegate ([d82358d](https://github.com/Overcastly-AI/hunt-maps/commit/d82358dafaaf057f97a391e891c44d16fae7dc2d))
* record the verified research channels, and the tool-grant trap that wasted a dispatch ([624fac7](https://github.com/Overcastly-AI/hunt-maps/commit/624fac70c3780679ec063ae848e9fb3daa60a740))
* **research:** algorithm and simulation directions, and three defects found on the way ([2e543f8](https://github.com/Overcastly-AI/hunt-maps/commit/2e543f84f055b4476164c4d1de88f861474815d0))
* **workflows:** make the evidence loop check species-and-sample, not just the citation ([24086ef](https://github.com/Overcastly-AI/hunt-maps/commit/24086ef91fd6b0b992905c3d097e0a7b3ba16b31))
* **workflows:** wire game-biologist into the loops it was missing from ([c27523c](https://github.com/Overcastly-AI/hunt-maps/commit/c27523c3c5a0c86d492822c31a61693bbd580b01))
