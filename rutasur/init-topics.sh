#!/bin/bash
set -e

TOPICS=/opt/kafka/bin/kafka-topics.sh
BROKER=kafka:19092
D30=2592000000
D7=604800000

crear() {
  nombre="$1"
  shift
  $TOPICS --bootstrap-server $BROKER --create --if-not-exists \
    --topic "$nombre" --partitions 3 --replication-factor 1 "$@"
}

crear envios.estados          --config retention.ms=$D30
crear envios.promesas         --config cleanup.policy=compact
crear envios.reprogramaciones --config retention.ms=$D30
crear alertas.sla             --config retention.ms=$D7
crear notificaciones.enviadas --config retention.ms=$D7
crear envios.estados.dlq      --config retention.ms=$D30

$TOPICS --bootstrap-server $BROKER --list