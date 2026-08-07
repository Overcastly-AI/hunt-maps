{{/* Standard name helpers. */}}
{{- define "ridgeline.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "ridgeline.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "ridgeline.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "ridgeline.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "ridgeline.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "ridgeline.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "ridgeline.postgis.fullname" -}}
{{- printf "%s-postgis" (include "ridgeline.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "ridgeline.api.fullname" -}}
{{- printf "%s-api" (include "ridgeline.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "ridgeline.web.fullname" -}}
{{- printf "%s-web" (include "ridgeline.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "ridgeline.secretName" -}}
{{- if .Values.auth.existingSecret -}}
{{- .Values.auth.existingSecret -}}
{{- else -}}
{{- include "ridgeline.fullname" . -}}
{{- end -}}
{{- end -}}

{{/*
Resolve a secret value that must stay stable across upgrades.

Order: explicit value → value already stored in the live Secret → newly
generated. The `lookup` step is the important one. Without it, every
`helm upgrade` re-runs randAlphaNum and mints a *different* secret, which
for the JWT key logs every user out on every upgrade and for the Postgres
password locks the API out of a database whose password was set once at
volume initialisation and is not re-read afterwards. `lookup` returns an
empty map during `helm template` and `--dry-run`, so the generated branch
is what renders there — that is expected, and is why you should not diff
a dry-run's secret against the cluster and conclude it drifted.

Usage: {{ include "ridgeline.resolveSecret" (dict "ctx" $ "key" "jwt-secret" "value" .Values.auth.jwtSecret "length" 48) }}
*/}}
{{- define "ridgeline.resolveSecret" -}}
{{- $ctx := .ctx -}}
{{- if .value -}}
{{- .value -}}
{{- else -}}
{{- $existing := lookup "v1" "Secret" $ctx.Release.Namespace (include "ridgeline.secretName" $ctx) -}}
{{- if and $existing $existing.data (index $existing.data .key) -}}
{{- index $existing.data .key | b64dec -}}
{{- else -}}
{{- randAlphaNum (.length | int) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
The DATABASE_URL the API is given.

An external URL always wins — if someone points this at a managed PostGIS,
running the in-chart StatefulSet as well would be a second, silently unused
database. Note the password is URL-encoded: a generated password can contain
characters that are legal in a password and structural in a URI, and an
unencoded one produces a connection error that looks like bad credentials.
*/}}
{{- define "ridgeline.databaseUrl" -}}
{{- if .Values.externalDatabase.url -}}
{{- .Values.externalDatabase.url -}}
{{- else -}}
{{- $pw := include "ridgeline.resolveSecret" (dict "ctx" . "key" "postgres-password" "value" .Values.postgis.auth.password "length" 24) -}}
{{- printf "postgresql://%s:%s@%s:5432/%s" .Values.postgis.auth.username (urlquery $pw) (include "ridgeline.postgis.fullname" .) .Values.postgis.auth.database -}}
{{- end -}}
{{- end -}}

{{/*
The CORS origins the API is given.

Always the configured value, PLUS the ingress host whenever ingress is enabled
— because forgetting that is the single most common way this chart produces a
broken-looking install. The app loads perfectly, the map chrome renders, and
every request for data is blocked by the browser with a CORS error that names
an origin the operator never typed. Deriving it removes the failure mode
instead of documenting it.

The scheme follows the TLS config: if any `ingress.tls` entry lists this host,
it is https, otherwise http. Getting that wrong is just as fatal as omitting
the host, and it is not something anyone should have to remember.
*/}}
{{- define "ridgeline.corsOrigins" -}}
{{- $origins := list -}}
{{- if .Values.api.corsOrigins -}}
{{- range (splitList "," .Values.api.corsOrigins) -}}
{{- $t := trim . -}}
{{- if $t -}}{{- $origins = append $origins $t -}}{{- end -}}
{{- end -}}
{{- end -}}
{{- if and .Values.ingress.enabled .Values.ingress.host -}}
{{- $scheme := "http" -}}
{{- range .Values.ingress.tls -}}
{{- if has $.Values.ingress.host (.hosts | default list) -}}
{{- $scheme = "https" -}}
{{- end -}}
{{- end -}}
{{- $origins = append $origins (printf "%s://%s" $scheme $.Values.ingress.host) -}}
{{- end -}}
{{- join "," (uniq $origins) -}}
{{- end -}}
