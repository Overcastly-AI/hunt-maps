## [1.2.0](https://github.com/Overcastly-AI/hunt-maps/compare/v1.1.3...v1.2.0) (2026-08-09)

### Features

* **design:** CommandBar replaces the rail — the container was the problem ([ea6095c](https://github.com/Overcastly-AI/hunt-maps/commit/ea6095c131bf9d80683667a0a91f9bb071384189))
* **design:** the plate material, and Confidence ships for the first time ([f56241a](https://github.com/Overcastly-AI/hunt-maps/commit/f56241a5d43871aea4d2fe9f8e940e9e20fabf1c))
* **web:** properties, stands, observations and the saved-filter editor ([db779d4](https://github.com/Overcastly-AI/hunt-maps/commit/db779d4944331ffba1b1b947b4b0a0c9b03d3468))
* **web:** the app can call its own backend, and a readout that admits ignorance ([aeecf57](https://github.com/Overcastly-AI/hunt-maps/commit/aeecf576bb88066a5f2f63ed3583581d541e1e14))
* **web:** the offline region picker — the front door R8 was missing ([add172f](https://github.com/Overcastly-AI/hunt-maps/commit/add172f5154f9a9e12d8acaa008c01d93d9ce125))
* **web:** the tabbed drawer — stands, sightings and filters are reachable ([d7d861c](https://github.com/Overcastly-AI/hunt-maps/commit/d7d861c53c11aa29c6241b2e11df1b838294dc8e))
* **web:** wire the property routes ([5e5e2a0](https://github.com/Overcastly-AI/hunt-maps/commit/5e5e2a0709f458c31cddd7e5ab3dbfc98a2c0164))

### Fixes

* **api:** an absent bedding field rendered as a measured zero ([bd94718](https://github.com/Overcastly-AI/hunt-maps/commit/bd94718f21c25a7f4f2cba79b6b6374df66fb0f1))
* **api:** availability was the bounding box, not the boundary ([0e429a1](https://github.com/Overcastly-AI/hunt-maps/commit/0e429a108a06f505155d447877c2e17715fca2c8))
* **api:** fill the halo gridForBBox was allocating and never writing ([f140ed0](https://github.com/Overcastly-AI/hunt-maps/commit/f140ed0061e1718fcb62396c052e8c0e6a9d0a09))
* **api:** retry the boot migration — one refused connection killed the container ([6554fb5](https://github.com/Overcastly-AI/hunt-maps/commit/6554fb5410554698bc02ffb5c514a1b5f3e62fa8))
* **terrain:** "not a bench" and "flat ground" matched ground never measured ([2b75795](https://github.com/Overcastly-AI/hunt-maps/commit/2b757952b96456f80ed1eebbb5f7533ee99fdda2))
* **terrain:** bedding swallowed unknown data in three of five terms, not one ([c5b3ac7](https://github.com/Overcastly-AI/hunt-maps/commit/c5b3ac716c1d436d92c49e74a5ac546e83325988))
* **terrain:** NODATA passed the halo guard, so three layers reported "open ground" ([4e6b3f9](https://github.com/Overcastly-AI/hunt-maps/commit/4e6b3f962f5a12ede2b60677daec92f7c575929c))
* **terrain:** six operators read the NODATA sentinel as an elevation ([5a52812](https://github.com/Overcastly-AI/hunt-maps/commit/5a52812ba3046acf9db1b971f9730bce7bc491f2))
* **terrain:** VRM and TPI reported confident answers from one-sided samples ([8f6959e](https://github.com/Overcastly-AI/hunt-maps/commit/8f6959e354ecc30aedd0f79fb2ddd1cda9096d0e))
* **web:** offline writes survive, and a sick server is not an invalid session ([61a0ca6](https://github.com/Overcastly-AI/hunt-maps/commit/61a0ca6eb068b2723c22bf000d0c6732178e423b))
* **web:** R66 — bedding was never broken, the test harness was ([16b9535](https://github.com/Overcastly-AI/hunt-maps/commit/16b95356c5bf30ba745092dbc92fdd00706249a8))
* **web:** the bedding layer painted nothing — two independent bugs ([80982c9](https://github.com/Overcastly-AI/hunt-maps/commit/80982c98aa22f79fd6d628b132c9a09f5e78521e))
* **web:** the filter editor copied design-system colours instead of importing them ([2909ba7](https://github.com/Overcastly-AI/hunt-maps/commit/2909ba7e625a2372425a0bf3efcd0f452df6db60)), closes [#c9a253](https://github.com/Overcastly-AI/hunt-maps/issues/c9a253) [#c9a253](https://github.com/Overcastly-AI/hunt-maps/issues/c9a253)
* **web:** the left rail, fixed at the root — two audits, two different causes ([390f667](https://github.com/Overcastly-AI/hunt-maps/commit/390f66718cb987690222c7891a0afcfc90859f85))

### Documentation

* **design:** direction A — final pass after its own render check ([a6e75ac](https://github.com/Overcastly-AI/hunt-maps/commit/a6e75ac89c290d1cd891c6dd5ae744c2e6f240e8))
* **design:** direction A of three — "The Field Instrument" ([01b55fa](https://github.com/Overcastly-AI/hunt-maps/commit/01b55facdef9a56b0917809b8635855a1eb02312))
* **design:** direction B — fix rows that painted their own name over their description ([1c8735a](https://github.com/Overcastly-AI/hunt-maps/commit/1c8735af2a9034720feb187882279f783c77c46f))
* **design:** direction C — verification pass ([46992f9](https://github.com/Overcastly-AI/hunt-maps/commit/46992f9c5cea6cd82172fe7eb6184d3e4f97f127))
* **design:** direction D — explored, not chosen ([b67de1b](https://github.com/Overcastly-AI/hunt-maps/commit/b67de1bc4bd78c9403191af0782c88d5813a78b2))
* **design:** directions B and C — "The map is the entire product" / "The field record" ([8aff7d4](https://github.com/Overcastly-AI/hunt-maps/commit/8aff7d4fb6461a5f5be431010ca105a95f1a6ab2))
* **design:** implementation plan for Direction A, and a correction ([d1cba14](https://github.com/Overcastly-AI/hunt-maps/commit/d1cba1414b26a5b3c610fd25a50b34397951a85e))
* field audit of the map chrome, and the seven rows both audits produced ([ce49ef1](https://github.com/Overcastly-AI/hunt-maps/commit/ce49ef170afde8533246cce03a2a21a35a66e384))
* field QA on the real artifact — two criticals that would end a morning ([5912374](https://github.com/Overcastly-AI/hunt-maps/commit/591237465c7ce4defc22cfa8afcf0f2d4604effc))
* file R61 — the Confidence primitive has never been used ([9ec7a9c](https://github.com/Overcastly-AI/hunt-maps/commit/9ec7a9cd45df4856edd2784bd344d8fba244bed1))
* file R77 — real LiDAR ground truth, and what the sibling repo actually does ([23230a8](https://github.com/Overcastly-AI/hunt-maps/commit/23230a851290c9a74d618e9bd651a28a91134338))
* file the stale-bundle trap that cost time twice tonight ([db4e83d](https://github.com/Overcastly-AI/hunt-maps/commit/db4e83d8143b39b3295d1bdcd4c0c27a02c866a9))
* move R32 to Done — it shipped and the row never got retired ([f03504e](https://github.com/Overcastly-AI/hunt-maps/commit/f03504eff1e51ad82efc852d1c62ed2774a8c2d5))
* narrow R66 — the bedding engine is healthy, the browser path is not ([7e4b43d](https://github.com/Overcastly-AI/hunt-maps/commit/7e4b43d4878489e2619c4ee9f445b46789627244))
* product audit of the left-hand chrome — the rail is not the worst of it ([d0e3369](https://github.com/Overcastly-AI/hunt-maps/commit/d0e33696a3c670a43febae48797355e9a81e460b)), closes [#5](https://github.com/Overcastly-AI/hunt-maps/issues/5)
* R32 is a P0 — the bedding layer renders nothing ([4c49c5f](https://github.com/Overcastly-AI/hunt-maps/commit/4c49c5f0e941c77a7e2fea0b735b8c06fd97e42a))
* R8 shipped — record the P0 offline-coverage fix ([6f39efe](https://github.com/Overcastly-AI/hunt-maps/commit/6f39efe46dee9391ee881e09b01e88d435a9a412))
* record the bedding-model pass in ROADMAP and BACKLOG ([9d85d9d](https://github.com/Overcastly-AI/hunt-maps/commit/9d85d9d98e064b33742ddd81ba563cd6c9d33144))
* ROADMAP catches up with R69, R70 and the tabbed drawer ([b455d0b](https://github.com/Overcastly-AI/hunt-maps/commit/b455d0b2c20da841080d2b8529bed6ff4c52d80f))
* **terrain:** the retraction reached the register but never reached the source ([0e29c3d](https://github.com/Overcastly-AI/hunt-maps/commit/0e29c3de0c3d19d62094553b5fb47f4711ff7099))
* the analytics audit found two ship blockers the builder could not see ([b49e6df](https://github.com/Overcastly-AI/hunt-maps/commit/b49e6dfef95c487205ef959231c411c21d5fc784))
* the board was overstating the work by seven shipped rows ([817a52f](https://github.com/Overcastly-AI/hunt-maps/commit/817a52f260544af93a666d41346f2ddb284e130f))
* the cold-season mechanism figure was wrong, and it was ours ([bd46f83](https://github.com/Overcastly-AI/hunt-maps/commit/bd46f83ed533f0ac5fc7692467deba112c12822b))
* the engine claims shelter matters more than cover, and nobody chose that ([23529db](https://github.com/Overcastly-AI/hunt-maps/commit/23529db5a6de921b9c5db27e700f4a6e3b61ae45))

## [1.1.3](https://github.com/Overcastly-AI/hunt-maps/compare/v1.1.2...v1.1.3) (2026-08-07)

### Fixes

* **helm:** runAsNonRoot needs a numeric UID — the API pod could never start ([#11](https://github.com/Overcastly-AI/hunt-maps/issues/11)) ([ead2d32](https://github.com/Overcastly-AI/hunt-maps/commit/ead2d32cf6e75f2931c8ce062c7534562139d9dc))

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
