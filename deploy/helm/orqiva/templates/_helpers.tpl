{{/* ── [PCODE-214 | S15 | v0.1.0] T19.3 Several server nodes (events, presence and migrations across nodes) and a Helm chart ── */}}
{{- define "orqiva.name" -}}{{ .Release.Name }}-orqiva{{- end -}}
{{- define "orqiva.labels" -}}
app.kubernetes.io/name: orqiva
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end -}}
{{- define "orqiva.selector" -}}
app.kubernetes.io/name: orqiva
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
{{- define "orqiva.secret" -}}{{ .Values.secrets.existingSecret | default (include "orqiva.name" .) }}{{- end -}}
