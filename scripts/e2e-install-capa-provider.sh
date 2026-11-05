#!/usr/bin/env bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
RESET='\033[0m'

# ---------------------------------------------------------------------------
# Install the Cluster API Provider AWS (CAPA) through Rancher Turtles.
#
# The CAPA provisioner only shows on Cluster Create when a CAPIProvider named
# `aws` exists (CAPAProvisioner.hidden in pkg/capa/provisioner.ts), and the
# form needs the AWSCluster / AWSMachineTemplate CRDs it installs.
#
# No AWS credentials are given to the provider: the e2e suite answers every AWS
# call in the browser and never creates a cluster, so the controller only has
# to come up. Rancher instances used for manual testing run CAPA the same way.
# ---------------------------------------------------------------------------

CAPA_NAMESPACE=${CAPA_NAMESPACE:-capa-system}
wait=60

echo -e "${YELLOW}Waiting for the Turtles CAPIProvider CRD...${RESET}"
okay=0
while [ $okay -lt $wait ]; do
  if kubectl get crd capiproviders.turtles-capi.cattle.io > /dev/null 2>&1; then
    break
  fi
  echo "CAPIProvider CRD not found, checking again in 10s (total time waited: $((okay * 10))s)..."
  okay=$((okay+1))
  sleep 10
done

if [ $okay -eq $wait ]; then
  echo -e "${RED}Turtles did not install the CAPIProvider CRD in a reasonable time${RESET}"
  kubectl get pods --all-namespaces
  exit 1
fi

echo -e "${YELLOW}Creating the aws CAPIProvider..........${RESET}"
kubectl create namespace "$CAPA_NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f - <<EOF
apiVersion: turtles-capi.cattle.io/v1alpha1
kind: CAPIProvider
metadata:
  name: aws
  namespace: ${CAPA_NAMESPACE}
spec:
  type: infrastructure
  variables:
    AWS_B64ENCODED_CREDENTIALS: ""
EOF

echo -e "${YELLOW}Waiting for the aws CAPIProvider to be ready...${RESET}"
if ! kubectl -n "$CAPA_NAMESPACE" wait capiprovider/aws --for=condition=Ready --timeout=600s; then
  echo -e "${RED}The aws CAPIProvider did not become ready${RESET}"
  kubectl -n "$CAPA_NAMESPACE" get capiprovider aws -o yaml
  kubectl -n "$CAPA_NAMESPACE" get pods
  exit 1
fi

for crd in awsclusters.infrastructure.cluster.x-k8s.io awsmachinetemplates.infrastructure.cluster.x-k8s.io; do
  kubectl wait --for=condition=Established "crd/${crd}" --timeout=120s
done

echo -e "${GREEN}${BOLD}CAPA installed${RESET}"
