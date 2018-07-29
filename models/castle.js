const mongoose = require('mongoose')
const ObjectId = mongoose.Schema.Types.ObjectId;

module.exports = mongoose.model('Castle', {
  name: String,
  alternate_names: Array,
  type: String,
  dimensions: Array,
  location: Object,
  description: String,
  preserved: String,
  owners: Array,
  history: Array,
  litrature: Array,
  utilization: Array,
  links: Array,
  images: Array,
  abId: Number
})
