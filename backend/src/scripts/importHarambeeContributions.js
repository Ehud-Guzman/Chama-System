// One-time bulk import: harambee contributions for the families of the late
// David Wandera and Jane Nyangoye. Run manually — NEVER exposed as an API
// endpoint, matching the seedSuperAdmin.js convention.
//
//   node src/scripts/importHarambeeContributions.js
//
// For each row: finds the member by phone, or creates them if new, then logs
// a contribution under a "Bereavement – Wandera & Nyangoye" contribution type,
// dated today, method "mobile". Rows whose phone number is already registered
// to a DIFFERENT name are NOT guessed at — they're logged under the existing
// member and flagged in the summary so a human can verify which is correct.
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Member = require('../models/Member');
const Contribution = require('../models/Contribution');
const ContributionType = require('../models/ContributionType');
const { normalizePhone } = require('../utils/phone');
const { logAudit, snapshot } = require('../utils/auditLogger');

const TYPE_NAME = 'Bereavement – Wandera & Nyangoye';
const NOTE = 'Harambee for the families of the late David Wandera and Jane Nyangoye';
const METHOD = 'mobile';

// [firstName, lastName, phone, amount]
const ROWS = [
  ['Abraham', 'Kamau', '0722873244', 300],
  ['Aczirbeth', 'Kaburu', '0729995945', 300],
  ['Ajero', 'Githua', '0799905503', 300],
  ['Albert', 'Kibinge', '0712268735', 300],
  ['Alfred', 'Wauru', '0720332170', 300],
  ['Alice', 'Muthoni', '0723608610', 300],
  ['Alice', 'Monicah', '0724510725', 300],
  ['Amos', 'Ngugi', '0723915219', 300],
  ['Ann', 'Wangari', '0724304040', 300],
  ['Ann', 'Kamau', '0759293343', 300],
  ['Ann', 'Njeri', '0715071834', 300],
  ['Ann', 'Wanjiru', '0791752418', 300],
  ['Ann', 'Mungai', '0748852800', 300],
  ['Anna', 'Karanja', '0726469677', 300],
  ['Anne', 'Karanja', '0720671499', 300],
  ['Antony', 'Juma', '0795401188', 300],
  ['Apollo', 'Macharia', '0724035705', 300],
  ['Asaph', 'Ngotho', '0723818800', 900],
  ['Augustine', 'Kimani', '0722859524', 300],
  ['Beatrice', 'Mwangi', '0720656554', 300],
  ['Beatrice', 'Maina', '0727171168', 300],
  ['Beatrice', 'Wambui', '0700239740', 300],
  ['Benandetta', "Ndung'u", '0707425582', 300],
  ['Benard', 'Ndururi', '0727485882', 200],
  ['Benard', 'Wanderi', '0714727231', 300],
  ['Benjamin', 'Kinuthia', '0718828233', 500],
  ['Benson', 'Maina', '0711378348', 300],
  ['Benson', 'Kamau', '0725786757', 300],
  ['Benson', 'Waweru', '0725785958', 300],
  ['Besi', 'Mwangi', '0712459593', 300],
  ['Bethuel', 'Wangui', '0706776704', 300],
  ['Bilha', 'Njeri', '0712471896', 300],
  ['Bilhah', 'Wangui', '0704278644', 300],
  ['Boniface', 'Gachoka', '0740947454', 300],
  ['Boniface', 'Njihia', '0717630160', 300],
  ['Carolyn', 'Kiarie', '0728421052', 300],
  ['Cecilia', 'Njeru', '0721619409', 300],
  ['Charity', "M'mbagiri", '0721885262', 300],
  ['Charles', 'Kamau', '0725439421', 300],
  ['Charles', 'Kaburu', '0723315080', 300],
  ['Charles', 'Mwangi', '0703500745', 300],
  ['Christine', 'Oketch', '0702684618', 300],
  ['Christopher', 'Githiomi', '0722564320', 300],
  ['Clement', 'Wangai', '0721360111', 200],
  ['Daniel', 'Gichuhi', '0759534449', 300],
  ['Daniel', 'Wachira', '0721155490', 300],
  ['Daniel', 'Wachira', '0721155490', 300],
  ['Daniel', 'Wanyoike', '0720324428', 300],
  ['David', 'Mwithiga', '0707324060', 300],
  ['David', 'Kamak', '0727471665', 300],
  ['David', 'Njoroge', '0723170296', 300],
  ['David', 'Kigoto', '0718325198', 300],
  ['David', 'Kagai', '0741552676', 300],
  ['David', 'Kagai', '0741552676', 300],
  ['David', 'Mbugua', '0727744411', 200],
  ['David', 'Njenga', '0722174975', 100],
  ['David', 'Komba', '0726130689', 300],
  ['David', 'Mbugua', '0727744411', 100],
  ['David', 'Muturi', '0723373958', 300],
  ['Devarall', 'Onesmous', '0720656584', 300],
  ['Dishon', 'Njoroge', '0705948633', 100],
  ['Domtila', 'Kioko', '0725876609', 300],
  ['Dorcas', 'Mukinya', '0703432932', 300],
  ['Douglas', 'Nyarwati', '0742831035', 300],
  ['Duncan', 'Njenga', '0721710074', 300],
  ['Edith', 'Muigai', '0721441345', 300],
  ['Edward', 'Ndwati', '0746323660', 300],
  ['Elija', 'Macharia', '0724043859', 300],
  ['Elikanah', 'Nyingi', '0722422555', 300],
  ['Elizabeth', 'Muchiri', '0708639652', 500],
  ['Elizabeth', 'Kariuki', '0710207987', 300],
  ['Emily', 'Gathura', '0724704131', 300],
  ['Ephantus', 'Ngugi', '0722556542', 300],
  ['Ephantus', 'Ngugi', '0792885633', 300],
  ['Esther', 'Esiromo', '0727484537', 300],
  ['Esther', 'Njoki', '0723503558', 300],
  ['Esther', 'Kanyingi', '0758051657', 300],
  ['Esther', 'Wambua', '0716916703', 300],
  ['Esther', 'Tabitha', '0725816067', 300],
  ['Esther', 'Wanjiku', '0713575486', 300],
  ['Eunice', 'Mathenge', '0720987312', 300],
  ['Eunice', 'Mwangi', '0724164675', 300],
  ['Eunice', 'Mwangi', '0720739163', 300],
  ['Eustance', 'Mugwanja', '0727368458', 300],
  ['Evan', "Ndung'u", '0720327168', 300],
  ['Faith', 'Kamene', '0728044860', 500],
  ['Faith', 'Wanjima', '0798581381', 300],
  ['Faith', 'Kamindu', '0701483607', 300],
  ['Florence', 'Muswanyi', '0725903110', 300],
  ['Florence', 'Kilonzo', '0722967932', 300],
  ['Francis', 'Ngata', '0711405654', 300],
  ['Francis', 'Gitu', '0712952955', 300],
  ['Francis', 'Kangiri', '0725735255', 300],
  ['Fredrick', 'Miiri', '0727036388', 300],
  ['Gabriel', 'Mukunya', '0708471818', 300],
  ['Geoffrey', 'Kariuki', '0722410938', 300],
  ['Geoffrey', 'Mutiga', '0725505498', 300],
  ['Geoffrey', 'Muinami', '0728617166', 300],
  ['Geoffrey', 'Mwaura', '0724694643', 200],
  ['Geoffrey', 'Wanyoike', '0729839699', 300],
  ['George', 'Gitau', '0726324308', 300],
  ['George', 'Njoroge', '0722391280', 300],
  ['George', 'Kamunya', '0725774729', 300],
  ['Gerald', 'Kamau', '0729292648', 300],
  ['Gideon', 'Mbote', '0719365337', 300],
  ['Gideon', 'Muhia', '0722805742', 300],
  ['Godfreyn', 'Mwangi', '0717940049', 300],
  ['Grace', 'Chira', '0700242783', 300],
  ['Grace', 'Mungai', '0759841234', 300],
  ['Grace', 'Wairimu', '0720781001', 300],
  ['Gregory', 'Wanjiru', '0721582989', 300],
  ['Hannah', 'Kuria', '0725011885', 300],
  ['Hannah', 'Karanja', '0718270961', 200],
  ['Harrison', 'Kamau', '0711411970', 300],
  ['Harun', 'Wachira', '0700080444', 50],
  ['Hellen', 'Njoroge', '0721972530', 300],
  ['Henry', 'Muhuri', '0721705093', 800],
  ['Henry', 'Ngoshi', '0702171521', 300],
  ['Ibrahim', 'Muhoro', '0725507441', 300],
  ['Ibrahim', 'Kuria', '0724561433', 300],
  ['Irene', 'Kaiba', '0713324766', 300],
  ['Isaac', 'Mwaniki', '0791421578', 300],
  ['Isaac', 'Mukoma', '0721288437', 300],
  ['Isaac', 'Ndege', '0727893230', 300],
  ['Isaac', 'Karanja', '0725681307', 300],
  ['Isaac', 'Njogu', '0729357164', 300],
  ['Isaac', 'Wanjiru', '0720327168', 300],
  ['Isaiah', 'Kairo', '0724518204', 300],
  ['Jackson', 'Mwangi', '0715049801', 300],
  ['Jackson', 'Njoroge', '0728339500', 300],
  ['Jackson', "Ng'ang'a", '0707377477', 300],
  ['Jackson', 'Kimani', '0711410688', 300],
  ['Jackson', 'Tiras', '0722463562', 300],
  ['Jackson', 'Njuguna', '0702799904', 300],
  ['Jacob', 'Kiroha', '0793009681', 300],
  ['Jacqueline', 'Muraga', '0724672935', 300],
  ['James', 'Mwaniki', '0700377185', 300],
  ['James', 'Gethi', '0719734481', 300],
  ['James', 'Mariobo', '0717171077', 300],
  ['James', 'Wangari', '0728472114', 300],
  ['James', 'Muriuki', '0728701286', 300],
  ['James', 'Wanyiri', '0700499771', 300],
  ['James', 'Muiruri', '0723404243', 300],
  ['James', 'Njure', '0722245616', 300],
  ['James', 'Gakunyi', '0720410491', 300],
  ['James', 'Irungu', '0723389353', 300],
  ['James', 'Githii', '0723559044', 300],
  ['James', 'Wairagu', '0721320968', 300],
  ['Jane', 'Njogu', '0700491241', 300],
  ['Jane', 'Irungu', '0729441851', 300],
  ['Jane', 'Njoki', '0724906290', 300],
  ['Janet', 'Irungu', '0713452399', 300],
  ['Janet', 'Kiiru', '0722585282', 300],
  ['Jeremiah', 'Wamboka', '0723904606', 300],
  ['Jeremiah', 'Nderitu', '0720775201', 500],
  ['Joel', 'Buku', '0722246003', 300],
  ['Joel', 'Mathenge', '0700937770', 300],
  ['Joel', 'Mutonga', '0711181547', 300],
  ['Johana', 'Njoroge', '0792090058', 300],
  ['Johana', 'Mukuruma', '0748521593', 300],
  ['John', 'Karanja', '0722447699', 300],
  ['John', 'Muiruri', '0727170615', 300],
  ['John', 'Wambui', '0721547916', 300],
  ['John', 'Mathenge', '0725512580', 300],
  ['John', 'Mwangi', '0795322586', 300],
  ['John', 'Muroki', '0722300431', 300],
  ['John', 'Githumbi', '0796545662', 300],
  ['John', 'Wangui', '0796730921', 300],
  ['John', 'Wangui', '0796730921', 300],
  ['John', 'Gichingiri', '0714269305', 300],
  ['John', 'Kuria', '0796616409', 300],
  ['John', 'Kinyaru', '0713777161', 300],
  ['John', "Ng'ang'a", '0721752400', 300],
  ['John', 'Karugo', '0757439000', 300],
  ['John', 'Maina', '0721725485', 500],
  ['John', 'Wanyaga', '0726202370', 300],
  ['John', 'Chege', '0726095675', 300],
  ['John', 'Wachira', '0720075263', 300],
  ['John', 'Wahome', '0713611270', 300],
  ['Johnson', 'Muchiri', '0725344502', 300],
  ['Johnson', 'Nduati', '0740793516', 300],
  ['Johnstone', 'Kabege', '0722965247', 300],
  ['Jonah', 'Kuria', '0725312397', 300],
  ['Joseph', 'Mugo', '0720109757', 300],
  ['Joseph', 'Mwaniki', '0702113081', 300],
  ['Joseph', "Ndung'u", '0725521888', 300],
  ['Joseph', 'Maina', '0724706364', 300],
  ['Joseph', 'Gitau', '0748851340', 300],
  ['Joseph', 'Ndururi', '0723755663', 300],
  ['Joseph', 'Njuki', '0725852882', 300],
  ['Joseph', 'Mwaniki', '0727033308', 300],
  ['Joseph', 'Muiruri', '0711149744', 300],
  ['Joseph', 'Maina', '0720037930', 300],
  ['Joseph', 'Njuguna', '0725060684', 300],
  ['Joseph', 'Njoroge', '0723538683', 300],
  ['Joseph', 'Kiarie', '0748902203', 300],
  ['Joseph', 'Ihomba', '0720206242', 300],
  ['Joseph', 'Thuku', '0721669322', 300],
  ['Joseph', 'Njoki', '0705573301', 300],
  ['Joyce', 'Nyambura', '0723751284', 200],
  ['Juliah', 'Samuel', '0724919199', 300],
  ['Kaleb', 'Mwangi', '0714030746', 300],
  ['Kennedy', 'Mwaura', '0725253134', 300],
  ['Kevin', 'Maina', '0741163016', 300],
  ['Laban', 'Kariuki', '0721659780', 300],
  ['Laureen', 'Wanjiru', '0727440882', 300],
  ['Leah', 'Mundia', '0714389641', 300],
  ['Lilian', 'Maina', '0720492169', 300],
  ['Loise', 'Wangari', '0720672216', 300],
  ['Loise', 'Mugoh', '0701511256', 300],
  ['Loise', 'Kimani', '0745241837', 300],
  ['Lucy', 'Mburu', '0721800486', 300],
  ['Lucy', 'Kiburi', '0721583238', 300],
  ['Lucy', 'Mutinda', '0715030201', 300],
  ['Lucy', 'Muroki', '0711712854', 300],
  ['Lucy', 'Muthee', '0714643185', 300],
  ['Lucy', 'Njuru', '0723606822', 300],
  ['Lucy', 'Kinuthia', '0722499863', 300],
  ['Lucy', 'Kamutu', '0728316022', 300],
  ['Lynnet', 'Isichi', '0723938555', 300],
  ['Manasses', 'Thuo', '0742819557', 300],
  ['Margaret', 'Kiburi', '0729569667', 300],
  ['Margaret', 'Mwangi', '0700917512', 300],
  ['Margaret', 'Muriu', '0721486062', 500],
  ['Margaret', 'Kimani', '0723639235', 300],
  ['Margaret', 'Kamande', '0729214335', 300],
  ['Margaret', 'Ngure', '0741281274', 300],
  ['Maria', 'Ngigi', '0720002156', 300],
  ['Martha', 'Kinyanjui', '0724986888', 500],
  ['Mary', 'Karioki', '0722210149', 300],
  ['Mary', 'Wamboi', '0720464544', 300],
  ['Mary', 'Muchiri', '0723904611', 300],
  ['Mary', 'Mwangi', '0714172136', 300],
  ['Mary', 'Wabwire', '0741552676', 300],
  ['Mary', 'Wabwire', '0722393983', 300],
  ['Mary', 'Gathu', '0714401428', 300],
  ['Mary', 'Muruga', '0725515149', 300],
  ['Mary', 'Kiarie', '0758151075', 300],
  ['Mary', 'Kangethe', '0727862810', 300],
  ['Mary', 'Gitau', '0720950953', 300],
  ['Mary', 'Gikonyo', '0724493845', 300],
  ['Mercy', 'Mugo', '0725270111', 300],
  ['Mercy', 'Ngige', '0727912013', 300],
  ['Michael', 'Muchumi', '0710849271', 300],
  ['Michael', 'Kibaa', '0722970611', 300],
  ['Michael', 'Kiiru', '0723756888', 300],
  ['Michael', 'Njane', '0710253087', 600],
  ['Michael', 'Ciira', '0716499090', 300],
  ['Miriam', 'Njora', '0723400993', 300],
  ['Mishack', 'Mwaura', '0724906182', 300],
  ['Monicah', 'Chege', '0707030329', 300],
  ['Moses', 'Ngige', '0711844798', 300],
  ['Moses', 'Njoroge', '0723968100', 300],
  ['Moses', 'Wamiatu', '0720731617', 300],
  ['Moses', 'Maina', '0722634719', 300],
  ['Moses', 'Muiruri', '0706132024', 300],
  ['Nancy', 'Warutere', '0725319171', 300],
  ['Nancy', 'Mbogo', '0746018224', 300],
  ['Naomi', 'Kamau', '0729930079', 300],
  ['Naumi', 'Nduati', '0708848872', 300],
  ['Nicholus', 'Mbugua', '0700537792', 300],
  ['Patricia', 'Nyongesa', '0715233094', 500],
  ['Patrick', 'Kaniu', '0720672552', 300],
  ['Patrick', 'Kiragu', '0722834218', 300],
  ['Paul', 'Kinyua', '0715100311', 300],
  ['Paul', 'Kimani', '0729026926', 300],
  ['Paul', "King'ori", '0720063658', 500],
  ['Paul', 'Gachogu', '0723884701', 300],
  ['Paul', 'Gitonga', '0704907027', 300],
  ['Paustina', 'Salwa', '0722537440', 300],
  ['Peris', 'Njeri', '0727332396', 300],
  ['Peris', 'Mulege', '0725046587', 300],
  ['Peter', 'Kamau', '0721566643', 300],
  ['Peter', 'Kinyanjui Mc', '0721269671', 300],
  ['Peter', 'Njoroge', '0729927211', 300],
  ['Peter', 'Mbugua', '0721936581', 300],
  ['Peter', 'Macharia', '0729505964', 300],
  ['Peter', 'Kamau', '0714466261', 300],
  ['Peter', 'Wairimu', '0741540203', 300],
  ['Peter', 'Gitau', '0721697751', 500],
  ['Peter', 'Gachomo', '0711297279', 200],
  ['Peter', 'Macharia', '0714125754', 300],
  ['Peter', 'Murage', '0721280875', 300],
  ['Peter', 'Muli', '0724047636', 2500],
  ['Peter', 'Kangiri', '0727616414', 300],
  ['Peter', 'Mwaura', '0727577460', 300],
  ['Peter', 'Ribiro', '0722864847', 200],
  ['Peter', "Ng'ang'a", '0722637849', 300],
  ['Phillip', 'Kamau', '0726424146', 300],
  ['Purity', 'Ndirangu', '0715333906', 300],
  ['Rachael', 'Kamau', '0721287187', 300],
  ['Rahab', 'Mwangi', '0711424840', 300],
  ['Rahab', 'Kinutha', '0789692229', 300],
  ['Rebecca', 'Wanjiru', '0715141699', 300],
  ['Regina', 'Mathenge', '0758879575', 300],
  ['Reginah', 'Ngugi', '0716105645', 300],
  ['Reuben', 'Kamau', '0722802499', 300],
  ['Reuben', 'Kariuki', '0710277776', 300],
  ['Richard', 'Muya', '0712127480', 300],
  ['Robert', 'Macharia', '0727500394', 300],
  ['Robert', 'Nyawira', '0721270624', 300],
  ['Robert', "Njung'e", '0721238068', 300],
  ['Ruth', 'Muiruri', '0726099111', 300],
  ['Ruth', 'Njoroge', '0729566950', 300],
  ['Ruth', 'Maina', '0723305983', 300],
  ['Samson', 'Kanyi', '0704267069', 300],
  ['Samuel', 'Gitonga', '0725245930', 300],
  ['Samuel', 'Chege', '0722579380', 300],
  ['Samuel', 'Mwangi', '0727740363', 200],
  ['Samuel', 'Buxton', '0722425436', 300],
  ['Samuel', 'Njoroge', '0724300593', 300],
  ['Samuel', "Ng'ang'a", '0721323042', 300],
  ['Samuel', 'Maina', '0720330341', 300],
  ['Samuel', 'Theuri', '0724824336', 300],
  ['Samuel', 'Wanjiru', '0712167439', 300],
  ['Samuel', 'Njoroge', '0710873888', 300],
  ['Samuel', 'Muthoni', '0728624353', 300],
  ['Samuel', 'Chege', '0722236779', 300],
  ['Sarah', 'Mwangi', '0702413600', 300],
  ['Simon', 'Karigithe', '0718239489', 300],
  ['Simon', 'Kimani', '0707479669', 300],
  ['Simon', 'Karanja', '0114116947', 300],
  ['Simon', "Ng'ang'a", '0798703803', 300],
  ['Simon', 'Kibona', '0720693998', 300],
  ['Sraah', 'Wanjiku', '0721942337', 300],
  ['Stephen', 'Macharia', '0721610110', 300],
  ['Stephen', 'Rubiri', '0713764337', 300],
  ['Stephen', 'Kamau', '0721213507', 300],
  ['Stephen', 'Njuguna', '0722331757', 300],
  ['Stephen', 'Mbuthia', '0728586844', 300],
  ['Susan', 'Migwi', '0721383492', 300],
  ['Susan', 'Mburu', '0720967501', 300],
  ['Susan', 'Njau', '0723816292', 300],
  ['Susan', 'Kamau', '0725927390', 300],
  ['Symon', 'Chege', '0721706852', 300],
  ['Tabitha', 'Nyingi', '0715370300', 300],
  ['Tabitha', 'Wauru', '0711110346', 300],
  ['Tabitha', 'Maina', '0724555827', 300],
  ['Tabitha', 'Kariuki', '0725407938', 300],
  ['Teresa', 'Mwangi', '0721878264', 300],
  ['Teresia', 'Mukabi', '0743267444', 100],
  ['Teresia', 'Mugo', '0713456893', 300],
  ['Teresiah', 'Gichia', '0790391310', 200],
  ['Thomas', 'Kabue', '0711621088', 300],
  ['Timothy', 'Njoroge', '0791408707', 300],
  ['Timothy', 'Wairimu', '0701413087', 300],
  ['Tom', 'Kariuki', '0725793029', 300],
  ['Victor', 'Ndegwa', '0799031449', 1800],
  ['Waweru', 'Kabithi', '0712099947', 300],
  ['William', 'Wainoga', '0725466980', 300],
  ['Wilson', 'Mwangi', '0726698905', 300],
  ['Wilson', 'Runyori', '0711883370', 300],
  ['Zablon', 'Wachira', '0729955786', 300],
  ['Ziporrah', 'Kiarie', '0722684621', 300],
  ['Ziporrah', 'Muturi', '0712703428', 300],
  ['Zipporah', 'Mugo', '0725121180', 300],
];

async function nextRegNumber() {
  const last = await Member.findOne({ regNumber: /^CM-\d+$/ })
    .sort({ regNumber: -1 })
    .select('regNumber');
  const lastNum = last ? parseInt(last.regNumber.slice(3), 10) : 0;
  return `CM-${String(lastNum + 1).padStart(4, '0')}`;
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);

  const admin = await User.findOne({ role: 'super_admin' });
  if (!admin) {
    console.error('No super admin found — run seedSuperAdmin.js first.');
    await mongoose.disconnect();
    process.exit(1);
  }

  let type = await ContributionType.findOne({ name: TYPE_NAME });
  if (!type) {
    type = await ContributionType.create({ name: TYPE_NAME, createdBy: admin._id });
    await logAudit({
      action: 'create',
      entityType: 'ContributionType',
      entityId: type._id,
      performedBy: admin._id,
      after: snapshot(type),
    });
    console.log(`Created contribution type "${TYPE_NAME}"`);
  }

  let membersCreated = 0;
  let membersMatched = 0;
  let contributionsLogged = 0;
  let totalAmount = 0;
  const skipped = [];
  const notes = [];
  const runCounts = new Map(); // memberId -> times logged against them in this run

  for (let i = 0; i < ROWS.length; i++) {
    const [first, last, rawPhone, amount] = ROWS[i];
    const rowNum = i + 1;
    const name = `${first} ${last}`.trim();
    const normalized = normalizePhone(rawPhone);

    if (!normalized) {
      skipped.push({ row: rowNum, name, phone: rawPhone, reason: 'Invalid phone number' });
      continue;
    }

    let member = await Member.findOne({ phone: normalized });

    if (member) {
      membersMatched++;
      if (member.name.toLowerCase() !== name.toLowerCase()) {
        notes.push(
          `Row ${rowNum}: phone ${normalized} is registered as "${member.name}", this row lists ` +
            `"${name}" — contribution logged under the existing member "${member.name}". ` +
            `Verify which name/number is actually correct.`
        );
      }
    } else {
      const regNumber = await nextRegNumber();
      member = await Member.create({ name, phone: normalized, regNumber, createdBy: admin._id });
      await logAudit({
        action: 'create',
        entityType: 'Member',
        entityId: member._id,
        performedBy: admin._id,
        after: snapshot(member),
      });
      membersCreated++;
    }

    const priorCount = runCounts.get(String(member._id)) || 0;
    if (priorCount > 0) {
      notes.push(
        `Row ${rowNum}: "${name}" (${normalized}) appears ${priorCount + 1} times in this list — ` +
          `logged as a separate contribution each time. Verify this isn't a duplicate list entry.`
      );
    }
    runCounts.set(String(member._id), priorCount + 1);

    const contribution = await Contribution.create({
      memberId: member._id,
      typeId: type._id,
      amount,
      date: new Date(),
      method: METHOD,
      note: NOTE,
      loggedBy: admin._id,
    });
    await logAudit({
      action: 'create',
      entityType: 'Contribution',
      entityId: contribution._id,
      performedBy: admin._id,
      after: snapshot(contribution),
    });
    contributionsLogged++;
    totalAmount += amount;
  }

  console.log('\n--- Import complete ---');
  console.log(`Members created:         ${membersCreated}`);
  console.log(`Members already existed: ${membersMatched}`);
  console.log(`Contributions logged:    ${contributionsLogged}`);
  console.log(`Total amount logged:     Ksh ${totalAmount.toLocaleString()}`);
  console.log(`Skipped rows:            ${skipped.length}`);

  if (skipped.length > 0) {
    console.log('\nSkipped (fix and re-run manually for these):');
    skipped.forEach((s) => console.log(`  Row ${s.row} (${s.name}, ${s.phone}): ${s.reason}`));
  }
  if (notes.length > 0) {
    console.log('\nWorth a manual look:');
    notes.forEach((n) => console.log(`  ${n}`));
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
