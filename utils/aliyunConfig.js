const aliyunConfig = {
  regionId: 'cn-shanghai',
  productKey: 'k1e98eW9t6F',
  deviceName: 'wechat',
  deviceSecret: 'b78c101cb51d59ecd29119e2fea3d4f3',
  publishTopic: '/sys/k1e98eW9t6F/wechat/thing/event/property/post',
  subscribeTopic: '',
  useTls: true
};

function resolveAliyunConfig() {
  const publishTopic = aliyunConfig.publishTopic;
  const customRecvTopic = `/${aliyunConfig.productKey}/${aliyunConfig.deviceName}/user/recv_data`;

  return Object.assign({}, aliyunConfig, {
    publishTopic,
    customRecvTopic
  });
}

module.exports = {
  aliyunConfig,
  resolveAliyunConfig
};
