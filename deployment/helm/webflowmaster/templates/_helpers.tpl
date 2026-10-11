{{/*
Names and labels shared by every template. Kept to the plain Helm conventions so the static
check in scripts/helm-chart.test.mjs can reason about the templates without a helm binary.
*/}}

{{- define "webflowmaster.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "webflowmaster.fullname" -}}
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

{{- define "webflowmaster.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "webflowmaster.labels" -}}
helm.sh/chart: {{ include "webflowmaster.chart" . }}
app.kubernetes.io/name: {{ include "webflowmaster.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ default .Chart.AppVersion .Values.image.tag | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/* Selector labels never change between chart versions: a Deployment selector is immutable. */}}
{{- define "webflowmaster.selectorLabels" -}}
app.kubernetes.io/name: {{ include "webflowmaster.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "webflowmaster.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "webflowmaster.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* The Secret the pods read: the one the chart renders, or the one the operator created. */}}
{{- define "webflowmaster.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- printf "%s-secrets" (include "webflowmaster.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "webflowmaster.apiImage" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) -}}
{{- end -}}

{{- define "webflowmaster.workerImage" -}}
{{- printf "%s:%s" .Values.image.workerRepository (default .Chart.AppVersion .Values.image.tag) -}}
{{- end -}}

{{/*
Environment shared by the api and the worker: the non-secret values from the ConfigMap and the
secrets from the Secret. Role-specific variables are added by each Deployment.
*/}}
{{- define "webflowmaster.sharedEnvFrom" -}}
- configMapRef:
    name: {{ include "webflowmaster.fullname" . }}-config
- secretRef:
    name: {{ include "webflowmaster.secretName" . }}
{{- end -}}

{{/*
The worker waits WORKER_SHUTDOWN_GRACE_MS for its runs after SIGTERM; Kubernetes must wait at
least as long before SIGKILL, plus a margin for the process to close its connections.
*/}}
{{- define "webflowmaster.workerTerminationGracePeriodSeconds" -}}
{{- add (div (int .Values.config.workerShutdownGraceMs) 1000) (int .Values.worker.terminationGracePeriodMarginSeconds) -}}
{{- end -}}
