// db.js — Banco de dados compartilhado (agora vazio)
//
// O banco de equipamentos foi migrado para dentro dos contratos.
// Cada contrato armazena seus equipamentos em c.equipamentos, que ficam salvos
// no localStorage 'smm_contracts' e no backend.
//
// getEffDB() em api-client.js lê esses equipamentos direto de smm_contracts.
//
// Este arquivo é mantido para compatibilidade com scripts que ainda importam db.js.

const MACHINE_DB = {};
