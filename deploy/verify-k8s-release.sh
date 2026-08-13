#!/bin/sh
# Ridgeline — prove what a Kubernetes release is actually running and serving.
#
#   deploy/verify-k8s-release.sh                    # release "ridgeline", namespace "default"
#   deploy/verify-k8s-release.sh myrel hunting      # release, namespace
#
# Run it after every `helm upgrade`. It answers, with facts rather than
# opinions, the two questions that a green rollout does NOT answer:
#
#   1. WHICH image is running? `kubectl get pods` says Running for an image
#      that is eight releases old. With `image.tag: ""` falling back to
#      Chart.appVersion and `pullPolicy: IfNotPresent`, a cluster installed
#      once and upgraded without --version keeps the image it first pulled,
#      indefinitely, with every pod green.
#
#   2. Can the bundle it serves actually render terrain? Every terrain layer
#      rendered blank in every deployed container for months because the DEM
#      tile template was compiled into the bundle as an empty string. The pods
#      were Running the whole time. Liveness passed the whole time.
#
# Requires kubectl and curl. Uses a temporary port-forward, so it works on
# kind / minikube / k3d / Docker Desktop with no ingress.
set -eu

RELEASE="${1:-ridgeline}"
NS="${2:-default}"
LOCAL_PORT="${RIDGELINE_VERIFY_PORT:-18080}"
HERE=$(cd "$(dirname "$0")" && pwd)

command -v kubectl >/dev/null 2>&1 || { echo "kubectl is required" >&2; exit 2; }

echo "==> Release '$RELEASE' in namespace '$NS'"
echo

# ---------------------------------------------------------------------------
# 1. What is actually running — the resolved image tag, per deployment
# ---------------------------------------------------------------------------
# `.spec` is what Helm asked for; `.status.containerStatuses[].image` on the
# running pods is what the kubelet actually started. They differ exactly when a
# pull was skipped, which is the failure this whole script exists for.
echo "Deployment pod specs (what the chart asked for):"
kubectl -n "$NS" get deploy \
  -l "app.kubernetes.io/instance=$RELEASE" \
  -o custom-columns='DEPLOYMENT:.metadata.name,IMAGE:.spec.template.spec.containers[0].image,PULLPOLICY:.spec.template.spec.containers[0].imagePullPolicy' \
  || { echo "no deployments found for instance=$RELEASE in $NS" >&2; exit 1; }

echo
echo "Running pods (what the kubelet actually started, with the resolved digest):"
kubectl -n "$NS" get pods \
  -l "app.kubernetes.io/instance=$RELEASE" \
  -o custom-columns='POD:.metadata.name,STATUS:.status.phase,IMAGE:.status.containerStatuses[*].image,DIGEST:.status.containerStatuses[*].imageID' \
  || true

echo
if command -v helm >/dev/null 2>&1; then
  echo "Helm's view:"
  helm -n "$NS" list --filter "^$RELEASE\$" || true
  echo
fi

# ---------------------------------------------------------------------------
# 2. What it serves
# ---------------------------------------------------------------------------
SVC=$(kubectl -n "$NS" get svc \
  -l "app.kubernetes.io/instance=$RELEASE,app.kubernetes.io/component=web" \
  -o name 2>/dev/null | head -1)
if [ -z "$SVC" ]; then
  echo "!!  No web Service found for instance=$RELEASE in $NS." >&2
  exit 1
fi
PORT=$(kubectl -n "$NS" get "$SVC" -o jsonpath='{.spec.ports[0].port}')

echo "==> Port-forwarding $SVC ($PORT) to localhost:$LOCAL_PORT"
kubectl -n "$NS" port-forward "$SVC" "$LOCAL_PORT:$PORT" >/dev/null 2>&1 &
PF_PID=$!
# shellcheck disable=SC2064
trap "kill $PF_PID 2>/dev/null || true" EXIT INT TERM

i=0
while [ "$i" -lt 30 ]; do
  if curl -fsS "http://127.0.0.1:$LOCAL_PORT/index.html" >/dev/null 2>&1; then break; fi
  i=$((i + 1))
  sleep 1
done

echo
"$HERE/verify-served-artifact.sh" "http://127.0.0.1:$LOCAL_PORT"
