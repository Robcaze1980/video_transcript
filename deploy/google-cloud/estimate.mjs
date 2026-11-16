// Unit-price scenarios checked against provider price pages on 2026-11-12 (us-central1).
// Components only: excludes SQL disk/backups, network/operations, builds/logs/secrets and AI.
const sqlHourly=0.035;
const cpuSecond=0.000018;
const gibSecond=0.000002;
const gcsGibHour=0.000027397;
const round=value=>Math.round(value*1e6)/1e6;
const sqlCompute=round(sqlHourly*730);
const runHourly=round((2*cpuSecond+4*gibSecond)*3600);
const storage=round(20*730*gcsGibHour);
console.log(JSON.stringify({currency:'USD',region:'us-central1',estimateOnly:true,invoice:false,
  sqlCompute:{tier:'db-g1-small',hours:730,cost:sqlCompute,highAvailability:false,sharedCoreSla:false},
  run:{vcpus:2,memoryGiB:4,billing:'instance-based',costPerHour:runHourly,
    scenarios:[10,100,730].map(hours=>({hours,cost:round(runHourly*hours)}))},
  storage:{class:'STANDARD',GiB:20,hours:730,cost:storage},
  totalMonthlyBudget:null,approvedSpendingCap:null,
  excludes:['SQL disk and backups','network and operations','builds, registry, logs, secrets','AI and reviewers','tax'],
  sources:['https://cloud.google.com/sql/pricing','https://cloud.google.com/run/pricing','https://cloud.google.com/storage/pricing']},null,2));
